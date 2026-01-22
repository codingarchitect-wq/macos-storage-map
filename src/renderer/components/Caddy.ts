import { store } from '../state/store';
import { Modal } from './Modal';

export class Caddy {
  initialize(): void {
    const clearBtn = document.getElementById('btn-clear-caddy');
    const deleteBtn = document.getElementById('btn-delete-caddy');
    const secureDeleteBtn = document.getElementById('btn-secure-delete');

    clearBtn?.addEventListener('click', () => {
      store.clearCaddy();
    });

    deleteBtn?.addEventListener('click', () => {
      this.confirmDelete(false);
    });

    secureDeleteBtn?.addEventListener('click', () => {
      this.confirmDelete(true);
    });
  }

  render(): void {
    const state = store.getState();
    const caddy = state.caddy;

    const countEl = document.getElementById('caddy-count');
    const sizeEl = document.getElementById('caddy-size');
    const itemsEl = document.getElementById('caddy-items');
    const clearBtn = document.getElementById('btn-clear-caddy') as HTMLButtonElement;
    const deleteBtn = document.getElementById('btn-delete-caddy') as HTMLButtonElement;
    const secureDeleteBtn = document.getElementById('btn-secure-delete') as HTMLButtonElement;

    if (countEl) {
      countEl.textContent = `${caddy.length} item${caddy.length !== 1 ? 's' : ''}`;
    }

    if (sizeEl) {
      sizeEl.textContent = this.formatBytes(store.getCaddyTotalSize());
    }

    if (itemsEl) {
      itemsEl.innerHTML = caddy.map(item => `
        <div class="caddy-item" data-id="${item.node.id}">
          <span>${this.escapeHtml(item.node.name)}</span>
          <button class="remove" data-id="${item.node.id}">×</button>
        </div>
      `).join('');

      itemsEl.querySelectorAll('.remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = (btn as HTMLElement).dataset.id;
          if (id) {
            store.removeFromCaddy(id);
          }
        });
      });
    }

    const hasItems = caddy.length > 0;
    if (clearBtn) clearBtn.disabled = !hasItems;
    if (deleteBtn) deleteBtn.disabled = !hasItems;
    if (secureDeleteBtn) secureDeleteBtn.disabled = !hasItems;
  }

  private confirmDelete(secure: boolean): void {
    const state = store.getState();
    const caddy = state.caddy;

    if (caddy.length === 0) return;

    const totalSize = this.formatBytes(store.getCaddyTotalSize());
    const action = secure ? 'securely delete' : 'move to Trash';

    Modal.show({
      title: secure ? 'Secure Delete' : 'Delete Items',
      content: `
        <p>Are you sure you want to ${action} ${caddy.length} item${caddy.length !== 1 ? 's' : ''}?</p>
        <p><strong>Total size: ${totalSize}</strong></p>
        ${secure ? '<p class="warning">Warning: Securely deleted files cannot be recovered.</p>' : ''}
        <ul style="max-height: 200px; overflow-y: auto; margin-top: 12px;">
          ${caddy.slice(0, 20).map(item => `<li>${this.escapeHtml(item.node.name)}</li>`).join('')}
          ${caddy.length > 20 ? `<li>...and ${caddy.length - 20} more</li>` : ''}
        </ul>
      `,
      actions: [
        {
          label: 'Cancel',
          onClick: () => Modal.hide()
        },
        {
          label: secure ? 'Secure Delete' : 'Move to Trash',
          className: 'danger-btn',
          onClick: () => this.executeDelete(secure)
        }
      ]
    });
  }

  private async executeDelete(secure: boolean): Promise<void> {
    const state = store.getState();
    const paths = state.caddy.map(item => item.node.path);

    Modal.hide();

    try {
      const result = secure
        ? await window.storageMap.file.secureDelete(paths)
        : await window.storageMap.file.delete(paths);

      if (result.success) {
        store.clearCaddy();
      } else {
        Modal.show({
          title: 'Error',
          content: `<p>${result.error}</p>`,
          actions: [{ label: 'OK', onClick: () => Modal.hide() }]
        });
      }
    } catch (err) {
      Modal.show({
        title: 'Error',
        content: `<p>Failed to delete items: ${err instanceof Error ? err.message : 'Unknown error'}</p>`,
        actions: [{ label: 'OK', onClick: () => Modal.hide() }]
      });
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
