export interface FileNode {
  id: string;
  name: string;
  path: string;
  size: number;
  isDirectory: boolean;
  children?: FileNode[];
  modifiedTime: number;
  createdTime: number;
  category: FileCategory;
  isSymlink?: boolean;
  isRestricted?: boolean;
  hash?: string;
  // Directory whose children exist in the main process but weren't sent to the renderer yet
  childrenUnloaded?: boolean;
  // Placeholder summing several items ("N more items", "Other small files"). Its `path` is the parent
  // folder's, so it must never be acted on as a file: trashing that path would remove the whole folder.
  isAggregate?: boolean;
}

export type FileCategory =
  | 'documents'
  | 'applications'
  | 'media-audio'
  | 'media-video'
  | 'media-images'
  | 'developer'
  | 'archives'
  | 'system'
  | 'other';

export interface CategoryInfo {
  id: FileCategory;
  name: string;
  color: string;
  extensions: string[];
}

export interface ScanProgress {
  phase: 'counting' | 'scanning' | 'complete' | 'error';
  scannedFiles: number;
  totalFiles: number;
  scannedBytes: number;
  currentPath: string;
  percentComplete: number;
}

export interface ScanResult {
  root: FileNode;
  totalSize: number;
  totalFiles: number;
  scanDuration: number;
  volumeInfo: VolumeInfo;
}

// Sent to the renderer on scan completion: the tree trimmed to a node budget, plus totals for the whole scan
export interface ScanComplete extends ScanResult {
  categoryTotals: CategorySnapshot[];
}

export interface VolumeInfo {
  id: string;
  name: string;
  mountPoint: string;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  isRemovable: boolean;
  isNetwork: boolean;
  fsType: string;
}

export interface CategorySnapshot {
  category: FileCategory;
  bytes: number;
}

export interface ScanHistoryEntry {
  id: number;
  volumeId: string;
  timestamp: Date;
  totalBytes: number;
  freeBytes: number;
  categories: CategorySnapshot[];
}

export interface CaddyItem {
  node: FileNode;
  addedAt: number;
}

export interface DuplicateGroup {
  hash: string;
  size: number;
  files: FileNode[];
}

export interface AppPreferences {
  skipSymlinks: boolean;
  smallFileThreshold: number;
  useOrderedTreemap: boolean;
  theme: 'system' | 'light' | 'dark';
  categoryRules: Record<string, FileCategory>;
}

export interface IpcChannels {
  'scan:start': (path: string) => void;
  'scan:stop': () => void;
  'scan:progress': (progress: ScanProgress) => void;
  'scan:complete': (result: ScanComplete) => void;
  'scan:getSubtree': (path: string, maxNodes: number) => Promise<FileNode | null>;
  'scan:error': (error: string) => void;
  'file:delete': (paths: string[]) => Promise<{ success: boolean; error?: string }>;
  'file:secureDelete': (paths: string[]) => Promise<{ success: boolean; error?: string }>;
  'file:reveal': (path: string) => Promise<boolean>;
  'volumes:list': () => Promise<VolumeInfo[]>;
  'volumes:changed': (volumes: VolumeInfo[]) => void;
  'duplicates:scan': (path: string) => void;
  'duplicates:progress': (progress: { hashed: number; total: number }) => void;
  'duplicates:complete': (groups: DuplicateGroup[]) => void;
  'history:get': (volumeId: string) => Promise<ScanHistoryEntry[]>;
  'history:save': (entry: Omit<ScanHistoryEntry, 'id'>) => Promise<void>;
  'preferences:get': () => Promise<AppPreferences>;
  'preferences:set': (prefs: Partial<AppPreferences>) => Promise<void>;
}
