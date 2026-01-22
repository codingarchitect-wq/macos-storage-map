import { ipcMain } from 'electron';
import { FileScanner } from '../scanner/FileScanner';
import { listVolumes, watchVolumes } from '../scanner/VolumeDetector';
import { moveToTrash, revealInFinder } from '../file-ops/Trash';
import { secureDelete } from '../file-ops/SecureDelete';
import { DuplicateFinder, collectAllFiles } from '../duplicate/HashWorker';
import { getMainWindow, startPowerAssertion, stopPowerAssertion, getDatabase } from '../index';
import { FileNode, ScanResult, CategorySnapshot, FileCategory } from '../../shared/types';
import { CATEGORIES } from '../../shared/categories';

let currentScanner: FileScanner | null = null;
let duplicateFinder: DuplicateFinder | null = null;
let stopVolumeWatch: (() => void) | null = null;

export function setupIpcHandlers(): void {
  ipcMain.handle('scan:start', async (_event, scanPath: string) => {
    if (currentScanner) {
      currentScanner.abort();
    }

    currentScanner = new FileScanner({ skipSymlinks: true });
    const mainWindow = getMainWindow();

    currentScanner.on('progress', (progress) => {
      mainWindow?.webContents.send('scan:progress', progress);
    });

    currentScanner.on('batch', (nodes: FileNode[]) => {
      mainWindow?.webContents.send('scan:batch', nodes);
    });

    startPowerAssertion();

    try {
      const result = await currentScanner.scan(scanPath);

      const categories = calculateCategoryTotals(result.root);
      const db = getDatabase();
      db.saveScanHistory({
        volumeId: result.volumeInfo.id,
        timestamp: new Date(),
        totalBytes: result.volumeInfo.totalBytes,
        freeBytes: result.volumeInfo.freeBytes,
        categories
      });

      mainWindow?.webContents.send('scan:complete', result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      mainWindow?.webContents.send('scan:error', error);
      throw err;
    } finally {
      stopPowerAssertion();
      currentScanner = null;
    }
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

  ipcMain.handle('duplicates:scan', async (_event, rootNode: FileNode) => {
    if (!duplicateFinder) {
      duplicateFinder = new DuplicateFinder();
    }

    const mainWindow = getMainWindow();
    const files = collectAllFiles(rootNode);

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
