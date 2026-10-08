import { FileNode, VolumeInfo, CaddyItem, ScanProgress, DuplicateGroup, AppPreferences, FileCategory, CategorySnapshot } from '../../shared/types';
import { VIEW_NODE_BUDGET, findNodeByPath, hasUnloadedNodes, mergeSubtree } from '../../shared/tree';

// Enough for a directory's direct children (the scanner keeps at most ~1000 per directory)
const CHILDREN_FETCH_BUDGET = 2000;

export type ViewType = 'treemap' | 'sunburst' | 'barchart' | 'columns' | 'timeline' | 'duplicates';

export interface AppState {
  volumes: VolumeInfo[];
  selectedVolume: VolumeInfo | null;
  scanResult: { root: FileNode; volumeInfo: VolumeInfo; categoryTotals: CategorySnapshot[] } | null;
  currentPath: FileNode | null;
  // Bumped when loaded subtrees are attached to the tree in place
  treeVersion: number;
  navigationHistory: FileNode[];
  navigationIndex: number;
  isScanning: boolean;
  scanProgress: ScanProgress | null;
  currentView: ViewType;
  searchQuery: string;
  highlightedNodes: Set<string>;
  caddy: CaddyItem[];
  duplicates: DuplicateGroup[];
  isFindingDuplicates: boolean;
  duplicateProgress: { hashed: number; total: number } | null;
  preferences: AppPreferences;
  barchartType: 'folders' | 'files';
}

type Listener = () => void;

class Store {
  private state: AppState = {
    volumes: [],
    selectedVolume: null,
    scanResult: null,
    currentPath: null,
    treeVersion: 0,
    navigationHistory: [],
    navigationIndex: -1,
    isScanning: false,
    scanProgress: null,
    currentView: 'treemap',
    searchQuery: '',
    highlightedNodes: new Set(),
    caddy: [],
    duplicates: [],
    isFindingDuplicates: false,
    duplicateProgress: null,
    preferences: {
      skipSymlinks: true,
      smallFileThreshold: 1024 * 1024,
      useOrderedTreemap: false,
      theme: 'system',
      categoryRules: {}
    },
    barchartType: 'folders'
  };

  private listeners: Listener[] = [];
  // Paths whose subtree was fetched with the full node budget
  private loadedRoots = new Set<string>();
  private pendingLoads = new Set<string>();

  getState(): Readonly<AppState> {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  setVolumes(volumes: VolumeInfo[]): void {
    this.state = { ...this.state, volumes };
    this.emit();
  }

  selectVolume(volume: VolumeInfo | null): void {
    this.state = { ...this.state, selectedVolume: volume };
    this.emit();
  }

  startScan(): void {
    this.state = {
      ...this.state,
      isScanning: true,
      scanProgress: null,
      scanResult: null,
      currentPath: null,
      navigationHistory: [],
      navigationIndex: -1
    };
    this.emit();
  }

  updateScanProgress(progress: ScanProgress): void {
    this.state = { ...this.state, scanProgress: progress };
    this.emit();
  }

  completeScan(root: FileNode, volumeInfo: VolumeInfo, categoryTotals: CategorySnapshot[]): void {
    this.loadedRoots = new Set([root.path]);
    this.state = {
      ...this.state,
      isScanning: false,
      scanProgress: null,
      scanResult: { root, volumeInfo, categoryTotals },
      currentPath: root,
      navigationHistory: [root],
      navigationIndex: 0
    };
    this.emit();
  }

  cancelScan(): void {
    this.state = {
      ...this.state,
      isScanning: false,
      scanProgress: null
    };
    this.emit();
  }

  scanError(error: string): void {
    this.state = {
      ...this.state,
      isScanning: false,
      scanProgress: null
    };
    console.error('Scan error:', error);
    this.emit();
  }

  navigateTo(node: FileNode): void {
    if (!node.isDirectory) return;

    // Views pass pruned copies of nodes; use the store's own node so loaded subtrees attach to the tree
    const root = this.state.scanResult?.root;
    const target = (root && findNodeByPath(root, node.path)) || node;

    const newHistory = this.state.navigationHistory.slice(0, this.state.navigationIndex + 1);
    newHistory.push(target);

    this.state = {
      ...this.state,
      currentPath: target,
      navigationHistory: newHistory,
      navigationIndex: newHistory.length - 1
    };
    this.emit();
    this.ensureSubtreeLoaded(target);
  }

  // Makes sure the views have a full budget of nodes below `node` to draw
  private ensureSubtreeLoaded(node: FileNode): void {
    if (this.loadedRoots.has(node.path) || !hasUnloadedNodes(node)) return;
    void this.loadSubtree(node, VIEW_NODE_BUDGET);
  }

  ensureChildrenLoaded(node: FileNode): void {
    if (!node.childrenUnloaded) return;
    void this.loadSubtree(node, CHILDREN_FETCH_BUDGET);
  }

  private async loadSubtree(node: FileNode, maxNodes: number): Promise<void> {
    const scanResult = this.state.scanResult;
    const key = `${maxNodes}:${node.path}`;
    if (!scanResult || this.pendingLoads.has(key)) return;

    this.pendingLoads.add(key);
    try {
      const subtree = await window.storageMap.scan.getSubtree(node.path, maxNodes);
      // Drop the result if a new scan replaced the tree meanwhile
      if (!subtree || this.state.scanResult !== scanResult) return;

      mergeSubtree(node, subtree);
      if (maxNodes >= VIEW_NODE_BUDGET) {
        this.loadedRoots.add(node.path);
      }

      this.state = {
        ...this.state,
        treeVersion: this.state.treeVersion + 1,
        highlightedNodes: this.computeHighlights(this.state.searchQuery)
      };
      this.emit();
    } catch (err) {
      console.error('Failed to load folder contents:', err);
    } finally {
      this.pendingLoads.delete(key);
    }
  }

  navigateBack(): void {
    if (this.state.navigationIndex <= 0) return;

    const newIndex = this.state.navigationIndex - 1;
    this.state = {
      ...this.state,
      currentPath: this.state.navigationHistory[newIndex],
      navigationIndex: newIndex
    };
    this.emit();
    this.ensureSubtreeLoaded(this.state.navigationHistory[newIndex]);
  }

  navigateForward(): void {
    if (this.state.navigationIndex >= this.state.navigationHistory.length - 1) return;

    const newIndex = this.state.navigationIndex + 1;
    this.state = {
      ...this.state,
      currentPath: this.state.navigationHistory[newIndex],
      navigationIndex: newIndex
    };
    this.emit();
    this.ensureSubtreeLoaded(this.state.navigationHistory[newIndex]);
  }

  navigateHome(): void {
    if (!this.state.scanResult) return;

    this.navigateTo(this.state.scanResult.root);
  }

  setView(view: ViewType): void {
    this.state = { ...this.state, currentView: view };
    this.emit();
  }

  setSearchQuery(query: string): void {
    const highlightedNodes = this.computeHighlights(query);
    this.state = { ...this.state, searchQuery: query, highlightedNodes };
    this.emit();
  }

  private computeHighlights(query: string): Set<string> {
    const highlightedNodes = new Set<string>();

    if (query && this.state.currentPath) {
      this.findMatchingNodes(this.state.currentPath, query.toLowerCase(), highlightedNodes);
    }

    return highlightedNodes;
  }

  private findMatchingNodes(node: FileNode, query: string, matches: Set<string>): void {
    if (node.name.toLowerCase().includes(query)) {
      matches.add(node.id);
    }

    if (node.children) {
      for (const child of node.children) {
        this.findMatchingNodes(child, query, matches);
      }
    }
  }

  addToCaddy(node: FileNode): void {
    // Placeholders carry their parent folder's path; deleting it would remove the whole folder
    if (node.isAggregate) return;

    if (this.state.caddy.some(item => item.node.id === node.id)) {
      return;
    }

    this.state = {
      ...this.state,
      caddy: [...this.state.caddy, { node, addedAt: Date.now() }]
    };
    this.emit();
  }

  removeFromCaddy(nodeId: string): void {
    this.state = {
      ...this.state,
      caddy: this.state.caddy.filter(item => item.node.id !== nodeId)
    };
    this.emit();
  }

  clearCaddy(): void {
    this.state = { ...this.state, caddy: [] };
    this.emit();
  }

  startFindingDuplicates(): void {
    this.state = {
      ...this.state,
      isFindingDuplicates: true,
      duplicateProgress: null,
      duplicates: []
    };
    this.emit();
  }

  updateDuplicateProgress(progress: { hashed: number; total: number }): void {
    this.state = { ...this.state, duplicateProgress: progress };
    this.emit();
  }

  setDuplicates(groups: DuplicateGroup[]): void {
    this.state = {
      ...this.state,
      isFindingDuplicates: false,
      duplicateProgress: null,
      duplicates: groups
    };
    this.emit();
  }

  setPreferences(prefs: Partial<AppPreferences>): void {
    this.state = {
      ...this.state,
      preferences: { ...this.state.preferences, ...prefs }
    };
    this.emit();
  }

  setBarchartType(type: 'folders' | 'files'): void {
    this.state = { ...this.state, barchartType: type };
    this.emit();
  }

  canGoBack(): boolean {
    return this.state.navigationIndex > 0;
  }

  canGoForward(): boolean {
    return this.state.navigationIndex < this.state.navigationHistory.length - 1;
  }

  getCaddyTotalSize(): number {
    return this.state.caddy.reduce((sum, item) => sum + item.node.size, 0);
  }

  getBreadcrumbPath(): FileNode[] {
    if (!this.state.currentPath || !this.state.scanResult) return [];

    const path: FileNode[] = [];
    const targetPath = this.state.currentPath.path;

    const findPath = (node: FileNode): boolean => {
      if (node.path === targetPath) {
        path.push(node);
        return true;
      }

      if (node.children && targetPath.startsWith(node.path)) {
        for (const child of node.children) {
          if (findPath(child)) {
            path.unshift(node);
            return true;
          }
        }
      }

      return false;
    };

    findPath(this.state.scanResult.root);
    return path;
  }
}

export const store = new Store();
