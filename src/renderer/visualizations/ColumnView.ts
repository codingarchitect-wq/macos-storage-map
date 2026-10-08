import { store } from '../state/store';
import { FileNode } from '../../shared/types';
import { getCategoryColor } from '../../shared/categories';
import { Tooltip } from './Tooltip';

interface Column {
  node: FileNode;
  selectedChild: FileNode | null;
}

export class ColumnView {
  private container: HTMLElement | null = null;
  private columns: Column[] = [];

  initialize(): void {
    this.container = document.getElementById('columns-view');
    if (!this.container) return;

    this.container.addEventListener('contextmenu', (e) => {
      const target = (e.target as HTMLElement).closest('.column-item');
      if (target) {
        e.preventDefault();
        const nodeId = target.getAttribute('data-id');
        if (nodeId) {
          const node = this.findNodeById(nodeId);
          if (node) {
            store.addToCaddy(node);
          }
        }
      }
    });
  }

  render(): void {
    if (!this.container) return;

    const state = store.getState();
    if (!state.currentPath) {
      this.renderEmpty();
      return;
    }

    // Initialize columns from current path if empty or root changed
    if (this.columns.length === 0 || this.columns[0].node.id !== state.currentPath.id) {
      this.columns = [{ node: state.currentPath, selectedChild: null }];
    }

    this.container.innerHTML = '';

    for (let i = 0; i < this.columns.length; i++) {
      const column = this.columns[i];
      const columnEl = this.createColumn(column, i);
      this.container.appendChild(columnEl);
    }

    // Scroll to the rightmost column
    this.container.scrollLeft = this.container.scrollWidth;
  }

  private createColumn(column: Column, columnIndex: number): HTMLElement {
    const state = store.getState();
    const columnEl = document.createElement('div');
    columnEl.className = 'column';

    const children = column.node.children || [];

    // Sort by size descending
    const sortedChildren = [...children].sort((a, b) => b.size - a.size);

    for (const child of sortedChildren) {
      const itemEl = document.createElement('div');
      itemEl.className = 'column-item';
      itemEl.setAttribute('data-id', child.id);

      if (column.selectedChild?.id === child.id) {
        itemEl.classList.add('selected');
      }

      if (state.searchQuery && state.highlightedNodes.has(child.id)) {
        itemEl.classList.add('highlighted');
      } else if (state.searchQuery && !state.highlightedNodes.has(child.id)) {
        itemEl.classList.add('faded');
      }

      const sizeEl = document.createElement('span');
      sizeEl.className = 'column-item-size';
      sizeEl.textContent = this.formatBytes(child.size);
      sizeEl.style.color = getCategoryColor(child.category);

      const nameEl = document.createElement('span');
      nameEl.className = 'column-item-name';
      nameEl.textContent = child.name;

      itemEl.appendChild(sizeEl);
      itemEl.appendChild(nameEl);

      if (child.isDirectory) {
        const arrowEl = document.createElement('span');
        arrowEl.className = 'column-item-arrow';
        arrowEl.textContent = '▶';
        itemEl.appendChild(arrowEl);
      }

      itemEl.addEventListener('click', () => this.handleItemClick(columnIndex, child));
      itemEl.addEventListener('dblclick', () => this.handleItemDoubleClick(child));
      itemEl.addEventListener('mouseenter', (e) => Tooltip.show(e, child));
      itemEl.addEventListener('mousemove', (e) => Tooltip.move(e));
      itemEl.addEventListener('mouseleave', () => Tooltip.hide());

      columnEl.appendChild(itemEl);
    }

    if (sortedChildren.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'column-empty';
      emptyEl.textContent = column.node.childrenUnloaded ? 'Loading…' : 'Empty folder';
      columnEl.appendChild(emptyEl);
    }

    return columnEl;
  }

  private handleItemClick(columnIndex: number, child: FileNode): void {
    // Update selection in current column
    this.columns[columnIndex].selectedChild = child;

    // Remove all columns after this one
    this.columns = this.columns.slice(0, columnIndex + 1);

    // If it's a directory, add a new column
    if (child.isDirectory && (child.childrenUnloaded || (child.children && child.children.length > 0))) {
      this.columns.push({ node: child, selectedChild: null });
      store.ensureChildrenLoaded(child);
    }

    this.render();
  }

  private handleItemDoubleClick(child: FileNode): void {
    if (child.isDirectory) {
      // Navigate to this directory as the new root
      store.navigateTo(child);
      this.columns = [{ node: child, selectedChild: null }];
      this.render();
    } else {
      // Reveal file in Finder
      window.storageMap.file.reveal(child.path);
    }
  }

  private renderEmpty(): void {
    if (!this.container) return;
    this.container.innerHTML = '<div class="column-empty-state">Scan a volume to view files</div>';
  }

  private findNodeById(nodeId: string): FileNode | null {
    const state = store.getState();
    if (!state.scanResult) return null;

    const search = (node: FileNode): FileNode | null => {
      if (node.id === nodeId) return node;
      if (node.children) {
        for (const child of node.children) {
          const found = search(child);
          if (found) return found;
        }
      }
      return null;
    };

    return search(state.scanResult.root);
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 bytes';

    const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
    const k = 1024;

    if (bytes < k) return `${bytes} bytes`;

    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const value = bytes / Math.pow(k, i);

    // Format like OmniDiskSweeper: "45.8 GB", "311.3 MB", "4.1 kB"
    if (value >= 100) {
      return `${Math.round(value)} ${units[i]}`;
    } else if (value >= 10) {
      return `${value.toFixed(1)} ${units[i]}`;
    } else {
      return `${value.toFixed(1)} ${units[i]}`;
    }
  }
}
