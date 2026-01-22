import { app, BrowserWindow, nativeTheme, powerSaveBlocker } from 'electron';
import * as path from 'path';
import { setupIpcHandlers } from './ipc/handlers';
import { Database } from './database/Database';

let mainWindow: BrowserWindow | null = null;
let database: Database | null = null;
let powerBlockerId: number | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (powerBlockerId !== null) {
      powerSaveBlocker.stop(powerBlockerId);
      powerBlockerId = null;
    }
  });

  nativeTheme.on('updated', () => {
    mainWindow?.webContents.send('theme:changed', nativeTheme.shouldUseDarkColors);
  });
}

export function startPowerAssertion(): void {
  if (powerBlockerId === null) {
    powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');
  }
}

export function stopPowerAssertion(): void {
  if (powerBlockerId !== null) {
    powerSaveBlocker.stop(powerBlockerId);
    powerBlockerId = null;
  }
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function getDatabase(): Database {
  if (!database) {
    throw new Error('Database not initialized');
  }
  return database;
}

app.whenReady().then(async () => {
  database = new Database();
  await database.initialize();

  setupIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  database?.close();
  if (powerBlockerId !== null) {
    powerSaveBlocker.stop(powerBlockerId);
  }
});
