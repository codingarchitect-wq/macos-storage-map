import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { VolumeInfo } from '../../shared/types';

const execAsync = promisify(exec);

export async function listVolumes(): Promise<VolumeInfo[]> {
  const volumes: VolumeInfo[] = [];

  try {
    const { stdout } = await execAsync('df -Pk');
    const lines = stdout.trim().split('\n').slice(1);

    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length < 6) continue;

      const mountPoint = parts.slice(5).join(' ');

      if (!mountPoint.startsWith('/Volumes/') && mountPoint !== '/') {
        continue;
      }

      const filesystem = parts[0];
      const totalKb = parseInt(parts[1], 10);
      const availableKb = parseInt(parts[3], 10);

      const totalBytes = totalKb * 1024;
      const freeBytes = availableKb * 1024;
      const usedBytes = totalBytes - freeBytes;

      const isNetwork = filesystem.includes(':') || filesystem.startsWith('//');
      const isRemovable = mountPoint.startsWith('/Volumes/');

      volumes.push({
        id: Buffer.from(mountPoint).toString('base64url'),
        name: mountPoint === '/' ? 'Macintosh HD' : path.basename(mountPoint),
        mountPoint,
        totalBytes,
        freeBytes,
        usedBytes,
        isRemovable,
        isNetwork,
        fsType: await getFilesystemType(mountPoint)
      });
    }
  } catch (err) {
    console.error('Error listing volumes:', err);
  }

  return volumes;
}

export async function getVolumeInfo(pathOnVolume: string): Promise<VolumeInfo> {
  const volumes = await listVolumes();

  let bestMatch: VolumeInfo | null = null;
  let bestMatchLength = 0;

  for (const vol of volumes) {
    if (pathOnVolume.startsWith(vol.mountPoint) && vol.mountPoint.length > bestMatchLength) {
      bestMatch = vol;
      bestMatchLength = vol.mountPoint.length;
    }
  }

  if (bestMatch) {
    return bestMatch;
  }

  const stats = await fs.promises.statfs(pathOnVolume);

  return {
    id: Buffer.from(pathOnVolume).toString('base64url'),
    name: path.basename(pathOnVolume) || 'Unknown',
    mountPoint: pathOnVolume,
    totalBytes: stats.blocks * stats.bsize,
    freeBytes: stats.bfree * stats.bsize,
    usedBytes: (stats.blocks - stats.bfree) * stats.bsize,
    isRemovable: false,
    isNetwork: false,
    fsType: 'unknown'
  };
}

async function getFilesystemType(mountPoint: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`diskutil info "${mountPoint}" | grep "File System Personality"`);
    const match = stdout.match(/File System Personality:\s+(.+)/);
    return match ? match[1].trim() : 'unknown';
  } catch {
    return 'unknown';
  }
}

export function watchVolumes(callback: (volumes: VolumeInfo[]) => void): () => void {
  let intervalId: NodeJS.Timeout;

  const check = async () => {
    const volumes = await listVolumes();
    callback(volumes);
  };

  intervalId = setInterval(check, 5000);
  check();

  return () => {
    clearInterval(intervalId);
  };
}
