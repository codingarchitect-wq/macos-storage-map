interface ModalAction {
  label: string;
  className?: string;
  onClick: () => void;
}

interface ModalOptions {
  title: string;
  content: string;
  actions: ModalAction[];
}

export class Modal {
  private static instance: Modal | null = null;

  private overlay: HTMLElement;
  private titleEl: HTMLElement;
  private contentEl: HTMLElement;
  private actionsEl: HTMLElement;

  constructor() {
    this.overlay = document.getElementById('modal-overlay')!;
    this.titleEl = document.getElementById('modal-title')!;
    this.contentEl = document.getElementById('modal-content')!;
    this.actionsEl = document.getElementById('modal-actions')!;

    Modal.instance = this;
  }

  initialize(): void {
    const closeBtn = document.getElementById('modal-close');
    closeBtn?.addEventListener('click', () => Modal.hide());

    this.overlay?.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        Modal.hide();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.overlay.classList.contains('hidden')) {
        Modal.hide();
      }
    });
  }

  static show(options: ModalOptions): void {
    if (!Modal.instance) return;

    const modal = Modal.instance;
    modal.titleEl.textContent = options.title;
    modal.contentEl.innerHTML = options.content;

    modal.actionsEl.innerHTML = options.actions.map(action => `
      <button class="${action.className || ''}">${action.label}</button>
    `).join('');

    const buttons = modal.actionsEl.querySelectorAll('button');
    buttons.forEach((btn, i) => {
      btn.addEventListener('click', options.actions[i].onClick);
    });

    modal.overlay.classList.remove('hidden');
  }

  static hide(): void {
    if (!Modal.instance) return;
    Modal.instance.overlay.classList.add('hidden');
  }
}
