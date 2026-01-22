import { shell } from 'electron';
import * as fs from 'fs';

export interface DeleteResult {
  success: boolean;
  path: string;
  error?: string;
}

export async function moveToTrash(paths: string[]): Promise<DeleteResult[]> {
  const results: DeleteResult[] = [];

  for (const filePath of paths) {
    try {
      const isLocked = await isFileLocked(filePath);
      if (isLocked) {
        results.push({
          success: false,
          path: filePath,
          error: 'File is locked or in use'
        });
        continue;
      }

      await shell.trashItem(filePath);
      results.push({
        success: true,
        path: filePath
      });
    } catch (err) {
      results.push({
        success: false,
        path: filePath,
        error: err instanceof Error ? err.message : 'Unknown error'
      });
    }
  }

  return results;
}

async function isFileLocked(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.promises.stat(filePath);

    if (stats.isDirectory()) {
      await fs.promises.access(filePath, fs.constants.W_OK);
      return false;
    }

    const fd = await fs.promises.open(filePath, fs.constants.O_RDWR);
    await fd.close();
    return false;
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'EACCES' || error.code === 'EBUSY' || error.code === 'EPERM') {
      return true;
    }
    return false;
  }
}

export async function revealInFinder(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath, fs.constants.R_OK);
    shell.showItemInFolder(filePath);
    return true;
  } catch {
    return false;
  }
}
