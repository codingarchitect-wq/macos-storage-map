import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import {
  FileNode,
  ScanProgress,
  ScanResult,
  VolumeInfo,
  DuplicateGroup,
  ScanHistoryEntry,
  AppPreferences
} from '../shared/types';

type Callback<T> = (data: T) => void;

const api = {
  scan: {
    start: (path: string): Promise<ScanResult> =>
      ipcRenderer.invoke('scan:start', path),

    stop: (): Promise<void> =>
      ipcRenderer.invoke('scan:stop'),

    onProgress: (callback: Callback<ScanProgress>): (() => void) => {
      const handler = (_event: IpcRendererEvent, progress: ScanProgress) => callback(progress);
      ipcRenderer.on('scan:progress', handler);
      return () => ipcRenderer.removeListener('scan:progress', handler);
    },

    onBatch: (callback: Callback<FileNode[]>): (() => void) => {
      const handler = (_event: IpcRendererEvent, nodes: FileNode[]) => callback(nodes);
      ipcRenderer.on('scan:batch', handler);
      return () => ipcRenderer.removeListener('scan:batch', handler);
    },

    onComplete: (callback: Callback<ScanResult>): (() => void) => {
      const handler = (_event: IpcRendererEvent, result: ScanResult) => callback(result);
      ipcRenderer.on('scan:complete', handler);
      return () => ipcRenderer.removeListener('scan:complete', handler);
    },

    onError: (callback: Callback<string>): (() => void) => {
      const handler = (_event: IpcRendererEvent, error: string) => callback(error);
      ipcRenderer.on('scan:error', handler);
      return () => ipcRenderer.removeListener('scan:error', handler);
    }
  },

  file: {
    delete: (paths: string[]): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('file:delete', paths),

    secureDelete: (paths: string[]): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('file:secureDelete', paths),

    reveal: (path: string): Promise<boolean> =>
      ipcRenderer.invoke('file:reveal', path)
  },

  volumes: {
    list: (): Promise<VolumeInfo[]> =>
      ipcRenderer.invoke('volumes:list'),

    watch: (): Promise<void> =>
      ipcRenderer.invoke('volumes:watch'),

    unwatch: (): Promise<void> =>
      ipcRenderer.invoke('volumes:unwatch'),

    onChanged: (callback: Callback<VolumeInfo[]>): (() => void) => {
      const handler = (_event: IpcRendererEvent, volumes: VolumeInfo[]) => callback(volumes);
      ipcRenderer.on('volumes:changed', handler);
      return () => ipcRenderer.removeListener('volumes:changed', handler);
    }
  },

  duplicates: {
    scan: (rootNode: FileNode): Promise<DuplicateGroup[]> =>
      ipcRenderer.invoke('duplicates:scan', rootNode),

    onProgress: (callback: Callback<{ hashed: number; total: number }>): (() => void) => {
      const handler = (_event: IpcRendererEvent, progress: { hashed: number; total: number }) =>
        callback(progress);
      ipcRenderer.on('duplicates:progress', handler);
      return () => ipcRenderer.removeListener('duplicates:progress', handler);
    },

    onComplete: (callback: Callback<DuplicateGroup[]>): (() => void) => {
      const handler = (_event: IpcRendererEvent, groups: DuplicateGroup[]) => callback(groups);
      ipcRenderer.on('duplicates:complete', handler);
      return () => ipcRenderer.removeListener('duplicates:complete', handler);
    }
  },

  history: {
    get: (volumeId: string): Promise<ScanHistoryEntry[]> =>
      ipcRenderer.invoke('history:get', volumeId),

    save: (entry: Omit<ScanHistoryEntry, 'id'>): Promise<void> =>
      ipcRenderer.invoke('history:save', entry)
  },

  preferences: {
    get: (): Promise<AppPreferences> =>
      ipcRenderer.invoke('preferences:get'),

    set: (prefs: Partial<AppPreferences>): Promise<void> =>
      ipcRenderer.invoke('preferences:set', prefs)
  },

  theme: {
    onChanged: (callback: Callback<boolean>): (() => void) => {
      const handler = (_event: IpcRendererEvent, isDark: boolean) => callback(isDark);
      ipcRenderer.on('theme:changed', handler);
      return () => ipcRenderer.removeListener('theme:changed', handler);
    }
  }
};

export type StorageMapAPI = typeof api;

contextBridge.exposeInMainWorld('storageMap', api);
