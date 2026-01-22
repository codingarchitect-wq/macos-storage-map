import { FileNode } from '../../shared/types';

export class Tooltip {
  private static element: HTMLElement | null = null;

  static initialize(): void {
    Tooltip.element = document.getElementById('tooltip');
  }

  static show(event: MouseEvent, node: FileNode): void {
    if (!Tooltip.element) {
      Tooltip.initialize();
    }

    if (!Tooltip.element) return;

    const nameEl = document.getElementById('tooltip-name');
    const sizeEl = document.getElementById('tooltip-size');
    const modifiedEl = document.getElementById('tooltip-modified');
    const pathEl = document.getElementById('tooltip-path');

    if (nameEl) nameEl.textContent = node.name;
    if (sizeEl) sizeEl.textContent = `Size: ${Tooltip.formatBytes(node.size)}`;
    if (modifiedEl) modifiedEl.textContent = `Modified: ${Tooltip.formatDate(node.modifiedTime)}`;
    if (pathEl) pathEl.textContent = node.path;

    Tooltip.element.classList.remove('hidden');
    Tooltip.move(event);
  }

  static move(event: MouseEvent): void {
    if (!Tooltip.element) return;

    const offset = 15;
    const rect = Tooltip.element.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let x = event.clientX + offset;
    let y = event.clientY + offset;

    if (x + rect.width > viewportWidth) {
      x = event.clientX - rect.width - offset;
    }

    if (y + rect.height > viewportHeight) {
      y = event.clientY - rect.height - offset;
    }

    Tooltip.element.style.left = `${x}px`;
    Tooltip.element.style.top = `${y}px`;
  }

  static hide(): void {
    if (!Tooltip.element) return;
    Tooltip.element.classList.add('hidden');
  }

  private static formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  private static formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}
