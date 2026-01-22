import { store } from '../state/store';
import { DonutSummary } from '../visualizations/DonutSummary';
import { VolumeInfo } from '../../shared/types';

export class Sidebar {
  private donut: DonutSummary;

  constructor() {
    this.donut = new DonutSummary();
  }

  initialize(): void {
    this.donut.initialize();

    const volumeList = document.getElementById('volumes');
    volumeList?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const li = target.closest('li');
      if (!li) return;

      const volumeId = li.dataset.volumeId;
      const state = store.getState();
      const volume = state.volumes.find(v => v.id === volumeId);

      if (volume) {
        store.selectVolume(volume);
      }
    });
  }

  render(): void {
    const state = store.getState();
    this.renderVolumeList(state.volumes, state.selectedVolume);
    this.donut.render();
  }

  private renderVolumeList(volumes: VolumeInfo[], selected: VolumeInfo | null): void {
    const list = document.getElementById('volumes');
    if (!list) return;

    list.innerHTML = volumes.map(vol => {
      const usedPercent = Math.round((vol.usedBytes / vol.totalBytes) * 100);
      const freeStr = this.formatBytes(vol.freeBytes);
      const totalStr = this.formatBytes(vol.totalBytes);
      const isActive = selected?.id === vol.id;

      return `
        <li data-volume-id="${vol.id}" class="${isActive ? 'active' : ''}">
          <span class="volume-name">${this.escapeHtml(vol.name)}</span>
          <span class="volume-info">${freeStr} free of ${totalStr} (${usedPercent}% used)</span>
        </li>
      `;
    }).join('');
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
