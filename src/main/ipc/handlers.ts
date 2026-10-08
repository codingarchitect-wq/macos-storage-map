import { ipcMain } from 'electron';
import { FileScanner, ScanAbortedError } from '../scanner/FileScanner';
import { trimTree } from '../scanner/TreeTrimmer';
import { listVolumes, watchVolumes } from '../scanner/VolumeDetector';
import { moveToTrash, revealInFinder } from '../file-ops/Trash';
import { secureDelete } from '../file-ops/SecureDelete';
import { DuplicateFinder, collectAllFiles } from '../duplicate/HashWorker';
import { getMainWindow, startPowerAssertion, stopPowerAssertion, getDatabase } from '../index';
import { FileNode, ScanComplete, CategorySnapshot, FileCategory } from '../../shared/types';
import { CATEGORIES } from '../../shared/categories';
import { VIEW_NODE_BUDGET, findNodeByPath } from '../../shared/tree';

let currentScanner: FileScanner | null = null;
let duplicateFinder: DuplicateFinder | null = null;
let stopVolumeWatch: (() => void) | null = null;
// Full tree of the last completed scan. The renderer only gets trimmed copies (see scan:getSubtree).
let lastScanRoot: FileNode | null = null;

export function setupIpcHandlers(): void {
  ipcMain.handle('scan:start', async (_event, scanPath: string) => {
    currentScanner?.abort();
    lastScanRoot = null;

    const scanner = new FileScanner({ skipSymlinks: true });
    currentScanner = scanner;
    const mainWindow = getMainWindow();

    scanner.on('progress', (progress) => {
      if (currentScanner === scanner) {
        mainWindow?.webContents.send('scan:progress', progress);
      }
    });

    startPowerAssertion();

    try {
      const result = await scanner.scan(scanPath);
      if (currentScanner !== scanner) return;

      const categories = calculateCategoryTotals(result.root);
      const db = getDatabase();
      db.saveScanHistory({
        volumeId: result.volumeInfo.id,
        timestamp: new Date(),
        totalBytes: result.volumeInfo.totalBytes,
        freeBytes: result.volumeInfo.freeBytes,
        categories
      });

      lastScanRoot = result.root;
      const complete: ScanComplete = {
        ...result,
        root: trimTree(result.root, VIEW_NODE_BUDGET),
        categoryTotals: categories
      };
      mainWindow?.webContents.send('scan:complete', complete);
    } catch (err) {
      // A cancelled or superseded scan has nothing to report; the renderer already moved on
      if (err instanceof ScanAbortedError || currentScanner !== scanner) return;

      const error = err instanceof Error ? err.message : 'Unknown error';
      mainWindow?.webContents.send('scan:error', error);
      throw err;
    } finally {
      // Only clean up if no newer scan has taken over
      if (currentScanner === scanner) {
        currentScanner = null;
        stopPowerAssertion();
      }
    }
  });

  ipcMain.handle('scan:getSubtree', async (_event, dirPath: string, maxNodes: number) => {
    const node = lastScanRoot && findNodeByPath(lastScanRoot, dirPath);
    return node ? trimTree(node, Math.min(maxNodes, VIEW_NODE_BUDGET)) : null;
  });

  ipcMain.handle('scan:stop', async () => {
    if (currentScanner) {
      currentScanner.abort();
      currentScanner = null;
    }
    stopPowerAssertion();
  });

  ipcMain.handle('file:delete', async (_event, paths: string[]) => {
    const results = await moveToTrash(paths);
    const failed = results.filter(r => !r.success);

    if (failed.length > 0) {
      return {
        success: false,
        error: `Failed to delete ${failed.length} item(s): ${failed[0].error}`
      };
    }

    return { success: true };
  });

  ipcMain.handle('file:secureDelete', async (_event, paths: string[]) => {
    const results = await secureDelete(paths);
    const failed = results.filter(r => !r.success);

    if (failed.length > 0) {
      return {
        success: false,
        error: `Failed to securely delete ${failed.length} item(s): ${failed[0].error}`
      };
    }

    return { success: true };
  });

  ipcMain.handle('file:reveal', async (_event, filePath: string) => {
    return await revealInFinder(filePath);
  });

  ipcMain.handle('volumes:list', async () => {
    return await listVolumes();
  });

  ipcMain.handle('volumes:watch', async () => {
    if (stopVolumeWatch) {
      stopVolumeWatch();
    }

    const mainWindow = getMainWindow();
    stopVolumeWatch = watchVolumes((volumes) => {
      mainWindow?.webContents.send('volumes:changed', volumes);
    });
  });

  ipcMain.handle('volumes:unwatch', async () => {
    if (stopVolumeWatch) {
      stopVolumeWatch();
      stopVolumeWatch = null;
    }
  });

  ipcMain.handle('duplicates:scan', async (_event, rootPath: string) => {
    if (!duplicateFinder) {
      duplicateFinder = new DuplicateFinder();
    }

    const mainWindow = getMainWindow();
    const rootNode = lastScanRoot && findNodeByPath(lastScanRoot, rootPath);
    const files = rootNode ? collectAllFiles(rootNode) : [];

    const groups = await duplicateFinder.findDuplicates(files, (hashed, total) => {
      mainWindow?.webContents.send('duplicates:progress', { hashed, total });
    });

    mainWindow?.webContents.send('duplicates:complete', groups);
    return groups;
  });

  ipcMain.handle('history:get', async (_event, volumeId: string) => {
    const db = getDatabase();
    return db.getScanHistory(volumeId);
  });

  ipcMain.handle('history:save', async (_event, entry) => {
    const db = getDatabase();
    db.saveScanHistory(entry);
  });

  ipcMain.handle('preferences:get', async () => {
    const db = getDatabase();
    return db.getPreferences();
  });

  ipcMain.handle('preferences:set', async (_event, prefs) => {
    const db = getDatabase();
    db.setPreferences(prefs);
  });
}

function calculateCategoryTotals(root: FileNode): CategorySnapshot[] {
  const totals = new Map<FileCategory, number>();

  for (const cat of Object.keys(CATEGORIES) as FileCategory[]) {
    totals.set(cat, 0);
  }

  const traverse = (node: FileNode) => {
    if (!node.isDirectory) {
      const current = totals.get(node.category) || 0;
      totals.set(node.category, current + node.size);
    } else if (node.children) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  };

  traverse(root);

  return Array.from(totals.entries()).map(([category, bytes]) => ({
    category,
    bytes
  }));
}
