import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { FileNode, ScanProgress, ScanResult, VolumeInfo } from '../../shared/types';
import { getCategoryForExtension } from '../../shared/categories';
import { getVolumeInfo } from './VolumeDetector';

const PROGRESS_INTERVAL = 100;
const MAX_DEPTH = 10;
const MAX_CHILDREN_PER_DIR = 1000;
// Files stat'ed when sizing a directory that isn't scanned in full (past MAX_DEPTH or MAX_CHILDREN_PER_DIR)
const SUMMARY_MAX_FILES = 5000;
// Files stat'ed across all overflow entries of one directory, so a huge directory can't stall the scan
const OVERFLOW_MAX_FILES = 100_000;
const FS_TIMEOUT_MS = 10_000;
// libuv's default threadpool size: once this many calls are stuck, every other fs call queues behind them
const MAX_STUCK_FS_CALLS = 4;

const EXCLUDED_PATHS = new Set([
  '/System',
  '/private/var/vm',
  '/private/var/folders',
  '/.Spotlight-V100',
  '/.fseventsd',
  '/dev',
  '/Volumes',
  '/cores'
]);

// File Provider folders (iCloud Drive, Google Drive, OneDrive, Dropbox...). Reading them can block for a
// long time or trigger downloads when the provider is offline or slow.
const CLOUD_STORAGE_SUFFIXES = ['/Library/CloudStorage', '/Library/Mobile Documents'];

// Calls that timed out but never settled. Module-level because the threads they hold are process-wide.
let stuckFsCalls = 0;

export class ScanAbortedError extends Error {
  constructor() {
    super('Scan aborted');
  }
}

export class FileScanner extends EventEmitter {
  private aborted = false;
  private scannedFiles = 0;
  private scannedBytes = 0;
  private totalFiles = 0;
  private currentPath = '';
  private skipSymlinks = true;
  private skipCloudStorage = true;
  private lastProgressTime = 0;
  private rootPath = '';
  // Paths that timed out once; the estimate pass and the scan both visit top-level folders
  private unresponsivePaths = new Set<string>();

  constructor(options: { skipSymlinks?: boolean; skipCloudStorage?: boolean } = {}) {
    super();
    this.skipSymlinks = options.skipSymlinks ?? true;
    this.skipCloudStorage = options.skipCloudStorage ?? true;
  }

  async scan(rootPath: string): Promise<ScanResult> {
    this.aborted = false;
    this.scannedFiles = 0;
    this.scannedBytes = 0;
    this.lastProgressTime = Date.now();
    this.rootPath = rootPath;
    this.unresponsivePaths.clear();

    const startTime = Date.now();

    this.emitProgress('counting');
    this.totalFiles = await this.estimateFileCount(rootPath);

    this.emitProgress('scanning');
    const root = await this.scanDirectory(rootPath, 0);

    if (this.aborted) {
      throw new ScanAbortedError();
    }

    const volumeInfo = await getVolumeInfo(rootPath);
    const scanDuration = Date.now() - startTime;

    const result: ScanResult = {
      root,
      totalSize: this.scannedBytes,
      totalFiles: this.scannedFiles,
      scanDuration,
      volumeInfo
    };

    this.emitProgress('complete');
    return result;
  }

  abort(): void {
    this.aborted = true;
  }

  private shouldExclude(fullPath: string): boolean {
    if (this.skipCloudStorage && CLOUD_STORAGE_SUFFIXES.some(suffix => fullPath.endsWith(suffix))) {
      return true;
    }

    if (this.rootPath !== '/') return false;

    for (const excluded of EXCLUDED_PATHS) {
      if (fullPath === excluded || fullPath.startsWith(excluded + '/')) {
        return true;
      }
    }
    return false;
  }

  // Rejects if a filesystem call doesn't settle in time (offline network share, unresponsive File
  // Provider). The call itself can't be cancelled and keeps its libuv thread, so once enough are stuck
  // we fail fast instead of letting every remaining call wait out its own timeout.
  private withTimeout<T>(filePath: string, op: () => Promise<T>): Promise<T> {
    if (stuckFsCalls >= MAX_STUCK_FS_CALLS || this.unresponsivePaths.has(filePath)) {
      return Promise.reject(new Error('Filesystem not responding'));
    }

    const pending = op();

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        stuckFsCalls++;
        this.unresponsivePaths.add(filePath);
        pending.finally(() => { stuckFsCalls--; }).catch(() => {});
        reject(new Error(`Filesystem call timed out after ${FS_TIMEOUT_MS / 1000}s`));
      }, FS_TIMEOUT_MS);

      pending.then(
        value => { clearTimeout(timer); resolve(value); },
        err => { clearTimeout(timer); reject(err); }
      );
    });
  }

  private readdir(dirPath: string): Promise<fs.Dirent[]> {
    return this.withTimeout(dirPath, () => fs.promises.readdir(dirPath, { withFileTypes: true }));
  }

  private stat(filePath: string): Promise<fs.Stats> {
    return this.withTimeout(filePath, () => fs.promises.stat(filePath));
  }

  private async estimateFileCount(dirPath: string): Promise<number> {
    let count = 0;
    const maxDepth = 2;

    const estimate = async (currentPath: string, depth: number): Promise<void> => {
      if (this.aborted || depth > maxDepth) return;
      if (this.shouldExclude(currentPath)) return;

      try {
        const entries = await this.readdir(currentPath);
        count += Math.min(entries.length, 500);

        for (const entry of entries.slice(0, 50)) {
          if (entry.isDirectory() && !entry.isSymbolicLink()) {
            await estimate(path.join(currentPath, entry.name), depth + 1);
          }
        }
      } catch {
        // Skip directories we can't read
      }
    };

    await estimate(dirPath, 0);
    return Math.max(count * 20, 1000);
  }

  private async scanDirectory(dirPath: string, depth: number): Promise<FileNode> {
    const stats = await this.stat(dirPath);
    const name = path.basename(dirPath) || dirPath;

    const node: FileNode = {
      id: this.generateId(dirPath),
      name,
      path: dirPath,
      size: 0,
      isDirectory: true,
      modifiedTime: stats.mtimeMs,
      createdTime: stats.birthtimeMs,
      category: 'other',
      children: []
    };

    if (depth >= MAX_DEPTH) {
      const summary = await this.getDirectorySummary(dirPath, SUMMARY_MAX_FILES);
      node.size = summary.size;
      node.children = undefined;
      return node;
    }

    try {
      const entries = await this.readdir(dirPath);
      let childCount = 0;
      let skippedSize = 0;
      let skippedCount = 0;
      let overflowBudget = OVERFLOW_MAX_FILES;
      let overflowTruncated = false;

      for (const entry of entries) {
        if (this.aborted) break;

        const fullPath = path.join(dirPath, entry.name);
        this.currentPath = fullPath;

        if (this.shouldExclude(fullPath)) {
          continue;
        }

        if (childCount >= MAX_CHILDREN_PER_DIR) {
          if (overflowBudget <= 0) {
            // Out of budget: count the item without sizing it
            overflowTruncated = true;
            skippedCount++;
            continue;
          }

          try {
            if (entry.isFile()) {
              const s = await this.stat(fullPath);
              overflowBudget--;
              skippedSize += s.size;
              skippedCount++;
              this.scannedBytes += s.size;
              this.scannedFiles++;
              this.maybeEmitProgress();
            } else if (entry.isDirectory()) {
              const summary = await this.getDirectorySummary(fullPath, Math.min(SUMMARY_MAX_FILES, overflowBudget));
              overflowBudget -= summary.fileCount;
              skippedSize += summary.size;
              skippedCount += summary.fileCount;
            }
          } catch {}
          continue;
        }

        try {
          if (entry.isSymbolicLink()) {
            if (this.skipSymlinks) continue;
            const symlinkNode = await this.createSymlinkNode(fullPath, entry.name);
            node.children!.push(symlinkNode);
            childCount++;
          } else if (entry.isDirectory()) {
            const childDir = await this.scanDirectory(fullPath, depth + 1);
            node.children!.push(childDir);
            node.size += childDir.size;
            childCount++;
          } else if (entry.isFile()) {
            const fileNode = await this.createFileNode(fullPath, entry.name);
            node.children!.push(fileNode);
            node.size += fileNode.size;
            this.scannedBytes += fileNode.size;
            this.scannedFiles++;
            childCount++;

            this.maybeEmitProgress();
          }
        } catch (err) {
          const restrictedNode: FileNode = {
            id: this.generateId(fullPath),
            name: entry.name,
            path: fullPath,
            size: 0,
            isDirectory: entry.isDirectory(),
            modifiedTime: Date.now(),
            createdTime: Date.now(),
            category: 'system',
            isRestricted: true
          };
          node.children!.push(restrictedNode);
          childCount++;
        }
      }

      if (skippedCount > 0) {
        node.children!.push({
          id: this.generateId(dirPath + '/__overflow__'),
          name: `${skippedCount.toLocaleString()}${overflowTruncated ? '+' : ''} more items`,
          path: dirPath,
          size: skippedSize,
          isDirectory: false,
          modifiedTime: Date.now(),
          createdTime: Date.now(),
          category: 'other',
          isAggregate: true
        });
        node.size += skippedSize;
      }
    } catch (err) {
      node.isRestricted = true;
    }

    return node;
  }

  // Sizes a directory without building nodes for it, stopping after `maxFiles` files. Adds to the scan
  // totals as it goes so progress keeps moving.
  private async getDirectorySummary(dirPath: string, maxFiles: number): Promise<{ size: number; fileCount: number }> {
    let size = 0;
    let fileCount = 0;

    const scan = async (currentPath: string): Promise<boolean> => {
      if (this.aborted || fileCount >= maxFiles) return false;
      this.currentPath = currentPath;

      try {
        const entries = await this.readdir(currentPath);

        for (const entry of entries) {
          if (this.aborted || fileCount >= maxFiles) return false;

          const fullPath = path.join(currentPath, entry.name);

          if (entry.isSymbolicLink()) continue;
          if (this.shouldExclude(fullPath)) continue;

          try {
            if (entry.isFile()) {
              const s = await this.stat(fullPath);
              size += s.size;
              fileCount++;
              this.scannedBytes += s.size;
              this.scannedFiles++;
              this.maybeEmitProgress();
            } else if (entry.isDirectory()) {
              const cont = await scan(fullPath);
              if (!cont) return false;
            }
          } catch {}
        }
        return true;
      } catch {
        return true;
      }
    };

    await scan(dirPath);
    return { size, fileCount };
  }

  private async createFileNode(filePath: string, name: string): Promise<FileNode> {
    const stats = await this.stat(filePath);

    return {
      id: this.generateId(filePath),
      name,
      path: filePath,
      size: stats.size,
      isDirectory: false,
      modifiedTime: stats.mtimeMs,
      createdTime: stats.birthtimeMs,
      category: getCategoryForExtension(name)
    };
  }

  private async createSymlinkNode(filePath: string, name: string): Promise<FileNode> {
    let stats: fs.Stats;
    let isDirectory = false;

    try {
      stats = await this.stat(filePath);
      isDirectory = stats.isDirectory();
    } catch {
      stats = await this.withTimeout(filePath, () => fs.promises.lstat(filePath));
    }

    return {
      id: this.generateId(filePath),
      name,
      path: filePath,
      size: stats.size,
      isDirectory,
      modifiedTime: stats.mtimeMs,
      createdTime: stats.birthtimeMs,
      category: isDirectory ? 'other' : getCategoryForExtension(name),
      isSymlink: true
    };
  }

  private generateId(filePath: string): string {
    return Buffer.from(filePath).toString('base64url');
  }

  private maybeEmitProgress(): void {
    const now = Date.now();
    if (now - this.lastProgressTime >= PROGRESS_INTERVAL) {
      this.emitProgress('scanning');
      this.lastProgressTime = now;
    }
  }

  private emitProgress(phase: ScanProgress['phase']): void {
    const progress: ScanProgress = {
      phase,
      scannedFiles: this.scannedFiles,
      totalFiles: this.totalFiles,
      scannedBytes: this.scannedBytes,
      currentPath: this.currentPath,
      percentComplete: this.totalFiles > 0
        ? Math.min(100, Math.round((this.scannedFiles / this.totalFiles) * 100))
        : 0
    };
    this.emit('progress', progress);
  }
}
