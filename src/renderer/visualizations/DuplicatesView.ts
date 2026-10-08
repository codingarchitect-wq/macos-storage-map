import { store } from '../state/store';
import { DuplicateGroup, FileNode } from '../../shared/types';

export class DuplicatesView {
  private list: HTMLElement | null = null;
  private selectedForDeletion: Set<string> = new Set();

  initialize(): void {
    this.list = document.getElementById('duplicates-list');

    const findBtn = document.getElementById('btn-find-duplicates');
    findBtn?.addEventListener('click', () => this.startFindDuplicates());
  }

  render(): void {
    const state = store.getState();

    this.updateStatus(state);

    if (!this.list) return;

    if (state.duplicates.length === 0 && !state.isFindingDuplicates) {
      this.list.innerHTML = `
        <div class="empty-message">
          <p>Click "Find Duplicates" to scan for duplicate files.</p>
          <p>This will compare files by content hash.</p>
        </div>
      `;
      return;
    }

    if (state.isFindingDuplicates) {
      const progress = state.duplicateProgress;
      const progressText = progress
        ? `Hashing files: ${progress.hashed} / ${progress.total}`
        : 'Preparing...';

      this.list.innerHTML = `
        <div class="scanning-message">
          <p>${progressText}</p>
        </div>
      `;
      return;
    }

    this.renderDuplicateGroups(state.duplicates);
  }

  private renderDuplicateGroups(groups: DuplicateGroup[]): void {
    if (!this.list) return;

    const totalWaste = groups.reduce((sum, g) => sum + g.size * (g.files.length - 1), 0);

    this.list.innerHTML = `
      <div class="duplicates-summary">
        <p>Found ${groups.length} groups of duplicates</p>
        <p>Potential space savings: ${this.formatBytes(totalWaste)}</p>
        <div class="bulk-actions">
          <button id="btn-select-all-but-first">Select All But First</button>
          <button id="btn-add-selected-to-caddy" class="danger-btn">Add Selected to Caddy</button>
        </div>
      </div>
      ${groups.map((group, i) => this.renderGroup(group, i)).join('')}
    `;

    this.setupEventListeners();
  }

  private renderGroup(group: DuplicateGroup, index: number): string {
    const waste = group.size * (group.files.length - 1);

    return `
      <div class="duplicate-group" data-group="${index}">
        <div class="duplicate-group-header">
          <span>${group.files.length} copies (${this.formatBytes(group.size)} each)</span>
          <span>Wasted: ${this.formatBytes(waste)}</span>
        </div>
        ${group.files.map(file => this.renderFile(file)).join('')}
      </div>
    `;
  }

  private renderFile(file: FileNode): string {
    const isSelected = this.selectedForDeletion.has(file.id);

    return `
      <div class="duplicate-file" data-id="${file.id}" data-path="${this.escapeHtml(file.path)}">
        <input type="checkbox" ${isSelected ? 'checked' : ''}>
        <span class="file-name">${this.escapeHtml(file.name)}</span>
        <span class="file-path">${this.escapeHtml(file.path)}</span>
        <button class="reveal-btn" title="Reveal in Finder">📁</button>
      </div>
    `;
  }

  private setupEventListeners(): void {
    if (!this.list) return;

    this.list.querySelectorAll('.duplicate-file input').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        const fileDiv = target.closest('.duplicate-file') as HTMLElement;
        const fileId = fileDiv?.dataset.id;

        if (fileId) {
          if (target.checked) {
            this.selectedForDeletion.add(fileId);
          } else {
            this.selectedForDeletion.delete(fileId);
          }
        }
      });
    });

    this.list.querySelectorAll('.reveal-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const fileDiv = (e.target as HTMLElement).closest('.duplicate-file') as HTMLElement;
        const path = fileDiv?.dataset.path;
        if (path) {
          window.storageMap.file.reveal(path);
        }
      });
    });

    const selectAllBtn = document.getElementById('btn-select-all-but-first');
    selectAllBtn?.addEventListener('click', () => this.selectAllButFirst());

    const addToCaddyBtn = document.getElementById('btn-add-selected-to-caddy');
    addToCaddyBtn?.addEventListener('click', () => this.addSelectedToCaddy());
  }

  private selectAllButFirst(): void {
    const state = store.getState();
    this.selectedForDeletion.clear();

    for (const group of state.duplicates) {
      for (let i = 1; i < group.files.length; i++) {
        this.selectedForDeletion.add(group.files[i].id);
      }
    }

    this.render();
  }

  private addSelectedToCaddy(): void {
    const state = store.getState();

    for (const group of state.duplicates) {
      for (const file of group.files) {
        if (this.selectedForDeletion.has(file.id)) {
          store.addToCaddy(file);
        }
      }
    }

    this.selectedForDeletion.clear();
    this.render();
  }

  private async startFindDuplicates(): Promise<void> {
    const state = store.getState();

    if (!state.scanResult || state.isFindingDuplicates) {
      return;
    }

    store.startFindingDuplicates();

    try {
      await window.storageMap.duplicates.scan(state.scanResult.root.path);
    } catch (err) {
      console.error('Failed to find duplicates:', err);
    }
  }

  private updateStatus(state: ReturnType<typeof store.getState>): void {
    const statusEl = document.getElementById('duplicates-status');
    const findBtn = document.getElementById('btn-find-duplicates') as HTMLButtonElement;

    if (!statusEl || !findBtn) return;

    if (state.isFindingDuplicates) {
      findBtn.disabled = true;
      const progress = state.duplicateProgress;
      statusEl.textContent = progress
        ? `Hashing: ${progress.hashed}/${progress.total}`
        : 'Preparing...';
    } else if (state.duplicates.length > 0) {
      findBtn.disabled = false;
      statusEl.textContent = `${state.duplicates.length} groups found`;
    } else {
      findBtn.disabled = !state.scanResult;
      statusEl.textContent = state.scanResult ? 'Ready to scan' : 'Scan a folder first';
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  private escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}
