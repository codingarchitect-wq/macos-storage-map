import BetterSqlite3, { Database as SqliteDatabase } from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { ScanHistoryEntry, CategorySnapshot, AppPreferences, FileCategory } from '../../shared/types';

const DEFAULT_PREFERENCES: AppPreferences = {
  skipSymlinks: true,
  smallFileThreshold: 1024 * 1024,
  useOrderedTreemap: false,
  theme: 'system',
  categoryRules: {}
};

export class Database {
  private db: SqliteDatabase | null = null;
  private dbPath: string;

  constructor() {
    const appDataPath = app.getPath('userData');
    this.dbPath = path.join(appDataPath, 'storagemap.db');
  }

  async initialize(): Promise<void> {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new BetterSqlite3(this.dbPath);
    this.db.pragma('journal_mode = WAL');

    this.createTables();
  }

  private createTables(): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        volume_id TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        total_bytes INTEGER NOT NULL,
        free_bytes INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS category_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scan_id INTEGER NOT NULL,
        category TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS preferences (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_scans_volume ON scans(volume_id);
      CREATE INDEX IF NOT EXISTS idx_scans_timestamp ON scans(timestamp);
      CREATE INDEX IF NOT EXISTS idx_snapshots_scan ON category_snapshots(scan_id);
    `);
  }

  saveScanHistory(entry: Omit<ScanHistoryEntry, 'id'>): number {
    if (!this.db) throw new Error('Database not initialized');

    const insertScan = this.db.prepare(`
      INSERT INTO scans (volume_id, timestamp, total_bytes, free_bytes)
      VALUES (?, ?, ?, ?)
    `);

    const insertCategory = this.db.prepare(`
      INSERT INTO category_snapshots (scan_id, category, bytes)
      VALUES (?, ?, ?)
    `);

    const transaction = this.db.transaction(() => {
      const result = insertScan.run(
        entry.volumeId,
        entry.timestamp.toISOString(),
        entry.totalBytes,
        entry.freeBytes
      );

      const scanId = result.lastInsertRowid as number;

      for (const cat of entry.categories) {
        insertCategory.run(scanId, cat.category, cat.bytes);
      }

      return scanId;
    });

    return transaction();
  }

  getScanHistory(volumeId: string): ScanHistoryEntry[] {
    if (!this.db) throw new Error('Database not initialized');

    const scans = this.db.prepare(`
      SELECT id, volume_id, timestamp, total_bytes, free_bytes
      FROM scans
      WHERE volume_id = ?
      ORDER BY timestamp DESC
      LIMIT 100
    `).all(volumeId) as Array<{
      id: number;
      volume_id: string;
      timestamp: string;
      total_bytes: number;
      free_bytes: number;
    }>;

    const getCategories = this.db.prepare(`
      SELECT category, bytes
      FROM category_snapshots
      WHERE scan_id = ?
    `);

    return scans.map(scan => {
      const categories = getCategories.all(scan.id) as Array<{
        category: string;
        bytes: number;
      }>;

      return {
        id: scan.id,
        volumeId: scan.volume_id,
        timestamp: new Date(scan.timestamp),
        totalBytes: scan.total_bytes,
        freeBytes: scan.free_bytes,
        categories: categories.map(c => ({
          category: c.category as FileCategory,
          bytes: c.bytes
        }))
      };
    });
  }

  getPreferences(): AppPreferences {
    if (!this.db) throw new Error('Database not initialized');

    const row = this.db.prepare(`
      SELECT value FROM preferences WHERE key = 'app_preferences'
    `).get() as { value: string } | undefined;

    if (row) {
      try {
        return { ...DEFAULT_PREFERENCES, ...JSON.parse(row.value) };
      } catch {
        return DEFAULT_PREFERENCES;
      }
    }

    return DEFAULT_PREFERENCES;
  }

  setPreferences(prefs: Partial<AppPreferences>): void {
    if (!this.db) throw new Error('Database not initialized');

    const current = this.getPreferences();
    const updated = { ...current, ...prefs };

    this.db.prepare(`
      INSERT OR REPLACE INTO preferences (key, value)
      VALUES ('app_preferences', ?)
    `).run(JSON.stringify(updated));
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
