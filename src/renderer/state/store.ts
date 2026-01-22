import { FileNode, VolumeInfo, CaddyItem, ScanProgress, DuplicateGroup, AppPreferences, FileCategory } from '../../shared/types';

export type ViewType = 'treemap' | 'sunburst' | 'barchart' | 'columns' | 'timeline' | 'duplicates';

export interface AppState {
  volumes: VolumeInfo[];
  selectedVolume: VolumeInfo | null;
  scanResult: { root: FileNode; volumeInfo: VolumeInfo } | null;
  currentPath: FileNode | null;
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

  completeScan(root: FileNode, volumeInfo: VolumeInfo): void {
    this.state = {
      ...this.state,
      isScanning: false,
      scanProgress: null,
      scanResult: { root, volumeInfo },
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

    const newHistory = this.state.navigationHistory.slice(0, this.state.navigationIndex + 1);
    newHistory.push(node);

    this.state = {
      ...this.state,
      currentPath: node,
      navigationHistory: newHistory,
      navigationIndex: newHistory.length - 1
    };
    this.emit();
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
    const highlightedNodes = new Set<string>();

    if (query && this.state.currentPath) {
      const lowerQuery = query.toLowerCase();
      this.findMatchingNodes(this.state.currentPath, lowerQuery, highlightedNodes);
    }

    this.state = { ...this.state, searchQuery: query, highlightedNodes };
    this.emit();
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
