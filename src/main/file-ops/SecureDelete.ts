import * as fs from 'fs';
import * as path from 'path';

export interface SecureDeleteResult {
  success: boolean;
  path: string;
  error?: string;
}

export async function secureDelete(paths: string[]): Promise<SecureDeleteResult[]> {
  const results: SecureDeleteResult[] = [];

  for (const filePath of paths) {
    try {
      const stats = await fs.promises.stat(filePath);

      if (stats.isDirectory()) {
        await secureDeleteDirectory(filePath);
      } else {
        await secureDeleteFile(filePath, stats.size);
      }

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

async function secureDeleteFile(filePath: string, size: number): Promise<void> {
  const fd = await fs.promises.open(filePath, 'r+');

  try {
    const chunkSize = 64 * 1024;
    const zeroBuffer = Buffer.alloc(chunkSize, 0);

    let bytesWritten = 0;
    while (bytesWritten < size) {
      const remaining = size - bytesWritten;
      const toWrite = Math.min(chunkSize, remaining);

      if (toWrite < chunkSize) {
        await fd.write(Buffer.alloc(toWrite, 0), 0, toWrite, bytesWritten);
      } else {
        await fd.write(zeroBuffer, 0, chunkSize, bytesWritten);
      }

      bytesWritten += toWrite;
    }

    await fd.sync();
  } finally {
    await fd.close();
  }

  await fs.promises.unlink(filePath);
}

async function secureDeleteDirectory(dirPath: string): Promise<void> {
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      await secureDeleteDirectory(fullPath);
    } else {
      const stats = await fs.promises.stat(fullPath);
      await secureDeleteFile(fullPath, stats.size);
    }
  }

  await fs.promises.rmdir(dirPath);
}
