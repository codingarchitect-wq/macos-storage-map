import { store, ViewType } from '../state/store';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { Caddy } from './Caddy';
import { Treemap } from '../visualizations/Treemap';
import { Sunburst } from '../visualizations/Sunburst';
import { BarChart } from '../visualizations/BarChart';
import { ColumnView } from '../visualizations/ColumnView';
import { Timeline } from '../visualizations/Timeline';
import { DuplicatesView } from '../visualizations/DuplicatesView';
import { Modal } from './Modal';
import { StorageMapAPI } from '../../preload/preload';

declare global {
  interface Window {
    storageMap: StorageMapAPI;
  }
}

export class App {
  private sidebar: Sidebar;
  private header: Header;
  private caddy: Caddy;
  private treemap: Treemap;
  private sunburst: Sunburst;
  private barChart: BarChart;
  private columnView: ColumnView;
  private timeline: Timeline;
  private duplicatesView: DuplicatesView;
  private modal: Modal;
  private lastVizDeps: unknown[] = [];

  constructor() {
    this.sidebar = new Sidebar();
    this.header = new Header();
    this.caddy = new Caddy();
    this.treemap = new Treemap();
    this.sunburst = new Sunburst();
    this.barChart = new BarChart();
    this.columnView = new ColumnView();
    this.timeline = new Timeline();
    this.duplicatesView = new DuplicatesView();
    this.modal = new Modal();
  }

  async initialize(): Promise<void> {
    this.setupEventListeners();
    this.setupIpcListeners();

    store.subscribe(() => this.render());

    const [volumes, preferences] = await Promise.all([
      window.storageMap.volumes.list(),
      window.storageMap.preferences.get()
    ]);

    store.setVolumes(volumes);
    store.setPreferences(preferences);

    if (volumes.length > 0) {
      store.selectVolume(volumes[0]);
    }

    await window.storageMap.volumes.watch();

    this.sidebar.initialize();
    this.header.initialize();
    this.caddy.initialize();
    this.treemap.initialize();
    this.sunburst.initialize();
    this.barChart.initialize();
    this.columnView.initialize();
    this.timeline.initialize();
    this.duplicatesView.initialize();
    this.modal.initialize();

    this.render();
  }

  private setupEventListeners(): void {
    const viewTabs = document.querySelectorAll('.tab-btn');
    viewTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const view = (tab as HTMLElement).dataset.view as ViewType;
        store.setView(view);
      });
    });

    const scanBtn = document.getElementById('btn-scan');
    scanBtn?.addEventListener('click', () => this.startScan());

    const cancelBtn = document.getElementById('btn-cancel-scan');
    cancelBtn?.addEventListener('click', () => this.cancelScan());
  }

  private setupIpcListeners(): void {
    window.storageMap.scan.onProgress(progress => {
      store.updateScanProgress(progress);
    });

    window.storageMap.scan.onComplete(result => {
      store.completeScan(result.root, result.volumeInfo, result.categoryTotals);
    });

    window.storageMap.scan.onError(error => {
      store.scanError(error);
    });

    window.storageMap.volumes.onChanged(volumes => {
      store.setVolumes(volumes);
    });

    window.storageMap.duplicates.onProgress(progress => {
      store.updateDuplicateProgress(progress);
    });

    window.storageMap.duplicates.onComplete(groups => {
      store.setDuplicates(groups);
    });
  }

  private async startScan(): Promise<void> {
    const state = store.getState();
    if (!state.selectedVolume || state.isScanning) return;

    store.startScan();

    try {
      await window.storageMap.scan.start(state.selectedVolume.mountPoint);
    } catch (err) {
      console.error('Failed to start scan:', err);
    }
  }

  private async cancelScan(): Promise<void> {
    await window.storageMap.scan.stop();
    store.cancelScan();
  }

  private render(): void {
    const state = store.getState();

    document.querySelectorAll('.tab-btn').forEach(tab => {
      const view = (tab as HTMLElement).dataset.view;
      tab.classList.toggle('active', view === state.currentView);
    });

    document.querySelectorAll('.viz-view').forEach(view => {
      const viewId = view.id.replace('-view', '');
      view.classList.toggle('active', viewId === state.currentView);
    });

    const progressContainer = document.getElementById('progress-container');
    if (progressContainer) {
      progressContainer.classList.toggle('hidden', !state.isScanning);

      if (state.scanProgress) {
        const fill = document.getElementById('progress-fill');
        const text = document.getElementById('progress-text');

        if (fill) {
          fill.style.width = `${state.scanProgress.percentComplete}%`;
        }

        if (text) {
          const sizeStr = this.formatBytes(state.scanProgress.scannedBytes);
          text.textContent = `Scanned ${state.scanProgress.scannedFiles.toLocaleString()} files (${sizeStr})`;
        }
      }
    }

    const treemapToggle = document.getElementById('treemap-toggle') as HTMLElement;
    if (treemapToggle) {
      treemapToggle.style.display = state.currentView === 'treemap' ? 'flex' : 'none';
    }

    // Visualizations rebuild their DOM from the tree, so skip them when nothing they read has changed
    // (scan progress ticks, volume list refreshes, caddy edits)
    const vizDeps = [
      state.currentView, state.currentPath, state.treeVersion, state.scanResult, state.selectedVolume,
      state.searchQuery, state.highlightedNodes, state.preferences, state.barchartType,
      state.duplicates, state.isFindingDuplicates, state.duplicateProgress
    ];
    const vizChanged = vizDeps.some((dep, i) => dep !== this.lastVizDeps[i]);
    this.lastVizDeps = vizDeps;

    if (vizChanged) {
      switch (state.currentView) {
        case 'treemap':
          this.treemap.render();
          break;
        case 'sunburst':
          this.sunburst.render();
          break;
        case 'barchart':
          this.barChart.render();
          break;
        case 'columns':
          this.columnView.render();
          break;
        case 'timeline':
          this.timeline.render();
          break;
        case 'duplicates':
          this.duplicatesView.render();
          break;
      }
    }

    this.sidebar.render();
    this.header.render();
    this.caddy.render();
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
}
