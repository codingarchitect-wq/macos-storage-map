import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { FileNode, ScanProgress, ScanResult, VolumeInfo } from '../../shared/types';
import { getCategoryForExtension } from '../../shared/categories';
import { getVolumeInfo } from './VolumeDetector';

const BATCH_SIZE = 500;
const PROGRESS_INTERVAL = 100;
const MAX_DEPTH = 10;
const MAX_CHILDREN_PER_DIR = 1000;

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

export class FileScanner extends EventEmitter {
  private aborted = false;
  private scannedFiles = 0;
  private scannedBytes = 0;
  private totalFiles = 0;
  private currentPath = '';
  private skipSymlinks = true;
  private batch: FileNode[] = [];
  private lastProgressTime = 0;
  private rootPath = '';

  constructor(options: { skipSymlinks?: boolean } = {}) {
    super();
    this.skipSymlinks = options.skipSymlinks ?? true;
  }

  async scan(rootPath: string): Promise<ScanResult> {
    this.aborted = false;
    this.scannedFiles = 0;
    this.scannedBytes = 0;
    this.batch = [];
    this.lastProgressTime = Date.now();
    this.rootPath = rootPath;

    const startTime = Date.now();

    this.emitProgress('counting');
    this.totalFiles = await this.estimateFileCount(rootPath);

    this.emitProgress('scanning');
    const root = await this.scanDirectory(rootPath, 0);

    if (this.batch.length > 0) {
      this.emit('batch', this.batch);
      this.batch = [];
    }

    if (this.aborted) {
      throw new Error('Scan aborted');
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
    if (this.rootPath !== '/') return false;

    for (const excluded of EXCLUDED_PATHS) {
      if (fullPath === excluded || fullPath.startsWith(excluded + '/')) {
        return true;
      }
    }
    return false;
  }

  private async estimateFileCount(dirPath: string): Promise<number> {
    let count = 0;
    const maxDepth = 2;

    const estimate = async (currentPath: string, depth: number): Promise<void> => {
      if (this.aborted || depth > maxDepth) return;
      if (this.shouldExclude(currentPath)) return;

      try {
        const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
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
    const stats = await fs.promises.stat(dirPath);
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
      const summary = await this.getDirectorySummary(dirPath);
      node.size = summary.size;
      node.children = undefined;
      this.scannedBytes += summary.size;
      this.scannedFiles += summary.fileCount;
      return node;
    }

    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      let childCount = 0;
      let skippedSize = 0;
      let skippedCount = 0;

      for (const entry of entries) {
        if (this.aborted) break;

        const fullPath = path.join(dirPath, entry.name);
        this.currentPath = fullPath;

        if (this.shouldExclude(fullPath)) {
          continue;
        }

        if (childCount >= MAX_CHILDREN_PER_DIR) {
          try {
            if (entry.isFile()) {
              const s = await fs.promises.stat(fullPath);
              skippedSize += s.size;
              skippedCount++;
            } else if (entry.isDirectory()) {
              const summary = await this.getDirectorySummary(fullPath);
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

            this.batch.push(fileNode);
            if (this.batch.length >= BATCH_SIZE) {
              this.emit('batch', this.batch);
              this.batch = [];
            }

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
          name: `${skippedCount.toLocaleString()} more items`,
          path: dirPath,
          size: skippedSize,
          isDirectory: false,
          modifiedTime: Date.now(),
          createdTime: Date.now(),
          category: 'other'
        });
        node.size += skippedSize;
        this.scannedBytes += skippedSize;
        this.scannedFiles += skippedCount;
      }
    } catch (err) {
      node.isRestricted = true;
    }

    return node;
  }

  private async getDirectorySummary(dirPath: string): Promise<{ size: number; fileCount: number }> {
    let size = 0;
    let fileCount = 0;
    const maxItems = 5000;

    const scan = async (currentPath: string): Promise<boolean> => {
      if (this.aborted || fileCount >= maxItems) return false;

      try {
        const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });

        for (const entry of entries) {
          if (fileCount >= maxItems) return false;

          const fullPath = path.join(currentPath, entry.name);

          if (entry.isSymbolicLink()) continue;

          try {
            if (entry.isFile()) {
              const s = await fs.promises.stat(fullPath);
              size += s.size;
              fileCount++;
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
    const stats = await fs.promises.stat(filePath);

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
      stats = await fs.promises.stat(filePath);
      isDirectory = stats.isDirectory();
    } catch {
      stats = await fs.promises.lstat(filePath);
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
