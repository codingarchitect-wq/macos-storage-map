import { store } from '../state/store';
import { FileNode } from '../../shared/types';

export class Header {
  private searchTimeout: number | null = null;

  initialize(): void {
    const backBtn = document.getElementById('btn-back');
    const forwardBtn = document.getElementById('btn-forward');
    const homeBtn = document.getElementById('btn-home');
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    const clearSearchBtn = document.getElementById('btn-clear-search');
    const orderedToggle = document.getElementById('ordered-treemap') as HTMLInputElement;

    backBtn?.addEventListener('click', () => store.navigateBack());
    forwardBtn?.addEventListener('click', () => store.navigateForward());
    homeBtn?.addEventListener('click', () => store.navigateHome());

    searchInput?.addEventListener('input', () => {
      if (this.searchTimeout) {
        clearTimeout(this.searchTimeout);
      }

      this.searchTimeout = window.setTimeout(() => {
        store.setSearchQuery(searchInput.value.trim());
      }, 200);
    });

    clearSearchBtn?.addEventListener('click', () => {
      if (searchInput) {
        searchInput.value = '';
        store.setSearchQuery('');
      }
    });

    orderedToggle?.addEventListener('change', () => {
      store.setPreferences({ useOrderedTreemap: orderedToggle.checked });
      window.storageMap.preferences.set({ useOrderedTreemap: orderedToggle.checked });
    });
  }

  render(): void {
    const state = store.getState();

    const backBtn = document.getElementById('btn-back') as HTMLButtonElement;
    const forwardBtn = document.getElementById('btn-forward') as HTMLButtonElement;
    const clearSearchBtn = document.getElementById('btn-clear-search');
    const orderedToggle = document.getElementById('ordered-treemap') as HTMLInputElement;

    if (backBtn) {
      backBtn.disabled = !store.canGoBack();
    }

    if (forwardBtn) {
      forwardBtn.disabled = !store.canGoForward();
    }

    if (clearSearchBtn) {
      clearSearchBtn.classList.toggle('hidden', !state.searchQuery);
    }

    if (orderedToggle) {
      orderedToggle.checked = state.preferences.useOrderedTreemap;
    }

    this.renderBreadcrumb();
  }

  private renderBreadcrumb(): void {
    const container = document.getElementById('breadcrumb-path');
    if (!container) return;

    const path = store.getBreadcrumbPath();

    if (path.length === 0) {
      container.innerHTML = '<span class="no-selection">No folder selected</span>';
      return;
    }

    const maxItems = 4;
    let displayPath = path;

    if (path.length > maxItems) {
      displayPath = [
        path[0],
        { id: 'ellipsis', name: '...', path: '', size: 0, isDirectory: true, modifiedTime: 0, createdTime: 0, category: 'other' as const } as FileNode,
        ...path.slice(-2)
      ];
    }

    container.innerHTML = displayPath.map((node, i) => {
      if (node.id === 'ellipsis') {
        return '<span class="separator">…</span>';
      }

      const isLast = i === displayPath.length - 1;
      const separator = !isLast ? '<span class="separator">/</span>' : '';

      return `
        <span data-path="${this.escapeHtml(node.path)}" class="${isLast ? 'current' : ''}">${this.escapeHtml(node.name)}</span>
        ${separator}
      `;
    }).join('');

    container.querySelectorAll('span[data-path]').forEach(span => {
      span.addEventListener('click', () => {
        const nodePath = (span as HTMLElement).dataset.path;
        const state = store.getState();

        if (state.scanResult) {
          const node = this.findNodeByPath(state.scanResult.root, nodePath || '');
          if (node && node.isDirectory) {
            store.navigateTo(node);
          }
        }
      });
    });
  }

  private findNodeByPath(root: FileNode, targetPath: string): FileNode | null {
    if (root.path === targetPath) return root;

    if (root.children) {
      for (const child of root.children) {
        const found = this.findNodeByPath(child, targetPath);
        if (found) return found;
      }
    }

    return null;
  }

  private escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}
