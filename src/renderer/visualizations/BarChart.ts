import { store } from '../state/store';
import { FileNode } from '../../shared/types';
import { getCategoryColor } from '../../shared/categories';

export class BarChart {
  private container: HTMLElement | null = null;
  private content: HTMLElement | null = null;

  initialize(): void {
    this.container = document.getElementById('barchart-view');
    this.content = document.getElementById('barchart-content');

    const folderTab = document.querySelector('.barchart-tab[data-type="folders"]');
    const fileTab = document.querySelector('.barchart-tab[data-type="files"]');

    folderTab?.addEventListener('click', () => {
      store.setBarchartType('folders');
    });

    fileTab?.addEventListener('click', () => {
      store.setBarchartType('files');
    });
  }

  render(): void {
    if (!this.content) return;

    const state = store.getState();

    document.querySelectorAll('.barchart-tab').forEach(tab => {
      const type = (tab as HTMLElement).dataset.type;
      tab.classList.toggle('active', type === state.barchartType);
    });

    if (!state.currentPath) {
      this.content.innerHTML = '<p class="empty-message">Scan a folder to see results</p>';
      return;
    }

    const items = state.barchartType === 'folders'
      ? this.getLargestFolders(state.currentPath)
      : this.getLargestFiles(state.currentPath);

    if (items.length === 0) {
      this.content.innerHTML = `<p class="empty-message">No ${state.barchartType} found</p>`;
      return;
    }

    const maxSize = items[0].size;

    this.content.innerHTML = items.map(item => {
      const percentage = (item.size / maxSize) * 100;
      const color = getCategoryColor(item.category);
      const sizeStr = this.formatBytes(item.size);
      const isHighlighted = state.highlightedNodes.has(item.id);
      const isFaded = state.searchQuery !== '' && !isHighlighted;

      return `
        <div class="bar-item ${isFaded ? 'faded' : ''} ${isHighlighted ? 'highlighted' : ''}"
             data-path="${this.escapeHtml(item.path)}"
             data-is-directory="${item.isDirectory}">
          <div class="bar-visual">
            <div class="bar-fill" style="width: ${percentage}%; background: ${color}"></div>
          </div>
          <span class="bar-name">${this.escapeHtml(item.name)}</span>
          <span class="bar-size">${sizeStr}</span>
        </div>
      `;
    }).join('');

    this.content.querySelectorAll('.bar-item').forEach(item => {
      item.addEventListener('click', () => {
        const path = (item as HTMLElement).dataset.path;
        const isDirectory = (item as HTMLElement).dataset.isDirectory === 'true';

        if (isDirectory && path) {
          const node = this.findNodeByPath(store.getState().scanResult?.root, path);
          if (node) {
            store.navigateTo(node);
          }
        } else if (path) {
          window.storageMap.file.reveal(path);
        }
      });

      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const path = (item as HTMLElement).dataset.path;
        if (path) {
          const node = this.findNodeByPath(store.getState().scanResult?.root, path);
          if (node) {
            store.addToCaddy(node);
          }
        }
      });
    });
  }

  private getLargestFolders(root: FileNode): FileNode[] {
    const folders: FileNode[] = [];

    if (root.children) {
      for (const child of root.children) {
        if (child.isDirectory) {
          folders.push(child);
        }
      }
    }

    return folders
      .sort((a, b) => b.size - a.size)
      .slice(0, 20);
  }

  private getLargestFiles(root: FileNode): FileNode[] {
    const files: FileNode[] = [];

    const collectFiles = (node: FileNode) => {
      if (!node.isDirectory) {
        files.push(node);
      } else if (node.children) {
        for (const child of node.children) {
          collectFiles(child);
        }
      }
    };

    collectFiles(root);

    return files
      .sort((a, b) => b.size - a.size)
      .slice(0, 20);
  }

  private findNodeByPath(root: FileNode | undefined, targetPath: string): FileNode | null {
    if (!root) return null;
    if (root.path === targetPath) return root;

    if (root.children) {
      for (const child of root.children) {
        const found = this.findNodeByPath(child, targetPath);
        if (found) return found;
      }
    }

    return null;
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
