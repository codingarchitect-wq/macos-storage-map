import * as fs from 'fs';
import * as crypto from 'crypto';
import { FileNode, DuplicateGroup } from '../../shared/types';

const PARTIAL_HASH_SIZE = 4096; // 4KB from start and end
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB limit (skip very large files)
const MIN_FILE_SIZE = 4096; // 4KB minimum (skip tiny files)
const CONCURRENCY = 4;
const MAX_FILES_TO_HASH = 50000; // Limit total files to consider
const MAX_DUPLICATES_PER_SIZE = 100; // Limit duplicates per size bucket

interface HashResult {
  path: string;
  hash: string;
  size: number;
  error?: string;
}

export class DuplicateFinder {
  private aborted = false;

  async findDuplicates(
    files: FileNode[],
    onProgress?: (hashed: number, total: number) => void
  ): Promise<DuplicateGroup[]> {
    this.aborted = false;

    // Group files by size first (files must have same size to be duplicates)
    // Use a streaming approach - don't store all files in memory
    const filesBySize = new Map<number, { path: string; id: string; name: string; category: string }[]>();
    let totalConsidered = 0;

    for (const file of files) {
      if (this.aborted) break;
      if (file.isDirectory) continue;
      if (file.size < MIN_FILE_SIZE || file.size > MAX_FILE_SIZE) continue;
      if (totalConsidered >= MAX_FILES_TO_HASH) break;

      const existing = filesBySize.get(file.size);
      if (existing) {
        // Limit duplicates per size bucket to avoid memory issues
        if (existing.length < MAX_DUPLICATES_PER_SIZE) {
          existing.push({ path: file.path, id: file.id, name: file.name, category: file.category });
        }
      } else {
        filesBySize.set(file.size, [{ path: file.path, id: file.id, name: file.name, category: file.category }]);
      }
      totalConsidered++;
    }

    // Only keep sizes with multiple files (potential duplicates)
    const sizeBuckets: { size: number; files: { path: string; id: string; name: string; category: string }[] }[] = [];
    for (const [size, sizeFiles] of filesBySize) {
      if (sizeFiles.length > 1) {
        sizeBuckets.push({ size, files: sizeFiles });
      }
    }
    filesBySize.clear(); // Free memory

    // Sort by size descending (find largest duplicates first - more impactful)
    sizeBuckets.sort((a, b) => b.size - a.size);

    // Count total files to hash
    let totalToHash = 0;
    for (const bucket of sizeBuckets) {
      totalToHash += bucket.files.length;
    }

    if (totalToHash === 0) {
      return [];
    }

    // Process each size bucket
    const groups: DuplicateGroup[] = [];
    let hashedCount = 0;

    for (const bucket of sizeBuckets) {
      if (this.aborted) break;

      // Hash files in this size bucket
      const hashResults = new Map<string, { path: string; id: string; name: string; category: string }[]>();

      // Process in small batches
      for (let i = 0; i < bucket.files.length; i += CONCURRENCY) {
        if (this.aborted) break;

        const batch = bucket.files.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
          batch.map(file => this.hashFile(file.path, bucket.size))
        );

        for (let j = 0; j < results.length; j++) {
          const result = results[j];
          const file = batch[j];

          if (!result.error && result.hash) {
            const existing = hashResults.get(result.hash);
            if (existing) {
              existing.push(file);
            } else {
              hashResults.set(result.hash, [file]);
            }
          }
          hashedCount++;
        }

        onProgress?.(hashedCount, totalToHash);
      }

      // Create duplicate groups from this size bucket
      for (const [hash, hashFiles] of hashResults) {
        if (hashFiles.length > 1) {
          groups.push({
            hash,
            size: bucket.size,
            files: hashFiles.map(f => ({
              id: f.id,
              name: f.name,
              path: f.path,
              size: bucket.size,
              isDirectory: false,
              modifiedTime: 0,
              createdTime: 0,
              category: f.category as any,
              hash
            }))
          });
        }
      }
    }

    if (this.aborted) {
      return [];
    }

    // Sort by wasted space (size * (count - 1))
    groups.sort((a, b) => (b.size * (b.files.length - 1)) - (a.size * (a.files.length - 1)));

    // Limit total groups returned
    return groups.slice(0, 500);
  }

  abort(): void {
    this.aborted = true;
  }

  private async hashFile(filePath: string, fileSize: number): Promise<HashResult> {
    try {
      const fd = await fs.promises.open(filePath, 'r');

      try {
        const hash = crypto.createHash('md5');

        // For small files, hash the entire content
        if (fileSize <= PARTIAL_HASH_SIZE * 2) {
          const buffer = Buffer.alloc(fileSize);
          await fd.read(buffer, 0, fileSize, 0);
          hash.update(buffer);
        } else {
          // For larger files, hash first 4KB + last 4KB + file size
          const startBuffer = Buffer.alloc(PARTIAL_HASH_SIZE);
          const endBuffer = Buffer.alloc(PARTIAL_HASH_SIZE);

          await fd.read(startBuffer, 0, PARTIAL_HASH_SIZE, 0);
          await fd.read(endBuffer, 0, PARTIAL_HASH_SIZE, fileSize - PARTIAL_HASH_SIZE);

          hash.update(startBuffer);
          hash.update(endBuffer);
          // Include file size in hash to reduce false positives
          hash.update(Buffer.from(fileSize.toString()));
        }

        return { path: filePath, hash: hash.digest('hex'), size: fileSize };
      } finally {
        await fd.close();
      }
    } catch (err) {
      return {
        path: filePath,
        hash: '',
        size: fileSize,
        error: err instanceof Error ? err.message : 'Unknown error'
      };
    }
  }
}

// Optimized file collector that limits memory usage
export function collectAllFiles(node: FileNode, maxFiles: number = MAX_FILES_TO_HASH): FileNode[] {
  const files: FileNode[] = [];
  let count = 0;

  const traverse = (n: FileNode) => {
    if (count >= maxFiles) return;

    if (!n.isDirectory) {
      // Only collect files that could be duplicates
      if (n.size >= MIN_FILE_SIZE && n.size <= MAX_FILE_SIZE) {
        files.push({
          id: n.id,
          name: n.name,
          path: n.path,
          size: n.size,
          isDirectory: false,
          modifiedTime: n.modifiedTime,
          createdTime: n.createdTime,
          category: n.category
        });
        count++;
      }
    } else if (n.children) {
      for (const child of n.children) {
        if (count >= maxFiles) break;
        traverse(child);
      }
    }
  };

  traverse(node);
  return files;
}
