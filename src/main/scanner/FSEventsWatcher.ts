import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

export interface FSEvent {
  type: 'create' | 'modify' | 'delete' | 'rename';
  path: string;
  isDirectory: boolean;
}

export class FSEventsWatcher extends EventEmitter {
  private watchers: Map<string, fs.FSWatcher> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private debounceMs = 500;

  watch(dirPath: string): void {
    if (this.watchers.has(dirPath)) {
      return;
    }

    try {
      const watcher = fs.watch(dirPath, { recursive: true }, (eventType, filename) => {
        if (!filename) return;

        const fullPath = path.join(dirPath, filename);
        this.handleEvent(fullPath, eventType);
      });

      watcher.on('error', (err) => {
        console.error(`FSEvents error for ${dirPath}:`, err);
        this.unwatch(dirPath);
      });

      this.watchers.set(dirPath, watcher);
    } catch (err) {
      console.error(`Failed to watch ${dirPath}:`, err);
    }
  }

  unwatch(dirPath: string): void {
    const watcher = this.watchers.get(dirPath);
    if (watcher) {
      watcher.close();
      this.watchers.delete(dirPath);
    }
  }

  unwatchAll(): void {
    for (const [dirPath] of this.watchers) {
      this.unwatch(dirPath);
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  private handleEvent(fullPath: string, eventType: string): void {
    const existingTimer = this.debounceTimers.get(fullPath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      this.debounceTimers.delete(fullPath);

      try {
        const exists = await this.pathExists(fullPath);
        const isDirectory = exists ? (await fs.promises.stat(fullPath)).isDirectory() : false;

        let type: FSEvent['type'];
        if (eventType === 'rename') {
          type = exists ? 'create' : 'delete';
        } else {
          type = 'modify';
        }

        const event: FSEvent = {
          type,
          path: fullPath,
          isDirectory
        };

        this.emit('change', event);
      } catch (err) {
        // File may have been deleted between check and stat
      }
    }, this.debounceMs);

    this.debounceTimers.set(fullPath, timer);
  }

  private async pathExists(p: string): Promise<boolean> {
    try {
      await fs.promises.access(p);
      return true;
    } catch {
      return false;
    }
  }
}
