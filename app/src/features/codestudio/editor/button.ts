// The Accept button's state and its menu (DESIGN 5.3.1). The button itself is part of the ghost text widget
// (ghost.ts); this decides when it shows (the setting, the last pointer, a mouse over the ghost text), keeps its
// tooltip on the current chord, and opens the menu: Accept, Accept word, Accept line, Dismiss.

import { getSettings } from '../../../state/settings';
import { t } from '../../../strings/t';
import { acceptKeys } from './announce';
import type { AcceptPart, GhostActions } from './ghost';

type MenuItem = AcceptPart | 'dismiss';
const MENU_ITEMS: readonly MenuItem[] = ['all', 'word', 'line', 'dismiss'];

export interface ButtonHost {
  readonly root: HTMLElement;
  accept(part: AcceptPart): void;
  dismiss(): void;
}

export class AcceptButtons {
  private lastPointer: string | null = null;
  private hovering = false;
  private menu: HTMLElement | null = null;
  private menuStop: (() => void) | null = null;
  readonly actions: GhostActions;

  constructor(private readonly host: ButtonHost) {
    this.actions = {
      accept: (part) => this.choose(part),
      dismiss: () => this.choose('dismiss'),
      openMenu: (anchor) => this.openMenu(anchor),
      buttonVisible: () => this.visible(),
      buttonLabel: () => t('codeStudio.editor.acceptButton'),
      buttonTooltip: () => this.tooltip(),
    };
  }

  get menuOpen(): boolean {
    return this.menu !== null;
  }

  /** Watches the pointer over the ghost text. Returns a function that stops. */
  install(): () => void {
    const over = (event: PointerEvent) => this.hover(event, true);
    const out = (event: PointerEvent) => this.hover(event, false);
    this.host.root.addEventListener('pointerover', over);
    this.host.root.addEventListener('pointerout', out);
    return () => {
      this.host.root.removeEventListener('pointerover', over);
      this.host.root.removeEventListener('pointerout', out);
      this.closeMenu();
    };
  }

  pointer(type: string): void {
    this.lastPointer = type;
    this.refresh();
  }

  private choose(item: MenuItem): void {
    this.closeMenu();
    if (item === 'dismiss') this.host.dismiss();
    else this.host.accept(item);
  }

  private tooltip(): string {
    const keys = acceptKeys();
    return keys ? t('codeStudio.editor.acceptTooltip', { keys }) : t('codeStudio.editor.acceptButton');
  }

  private visible(): boolean {
    const mode = getSettings().code.acceptButton;
    if (mode === 'always') return true;
    if (mode === 'never') return false;
    return this.lastPointer === 'touch' || this.lastPointer === 'pen' || this.hovering;
  }

  /** The shown buttons follow the pointer, the setting, and a remapped chord in their tooltip. */
  refresh(): void {
    const visible = this.visible();
    const tooltip = this.tooltip();
    for (const button of this.host.root.querySelectorAll<HTMLButtonElement>('.cm-ghost-accept')) {
      button.hidden = !visible;
      button.title = tooltip;
    }
  }

  private hover(event: PointerEvent, entering: boolean): void {
    const ghost = event.target instanceof Element ? event.target.closest('.cm-ghost') : null;
    if (event.pointerType !== 'mouse' || !ghost) return;
    const related = event.relatedTarget instanceof Element ? event.relatedTarget.closest('.cm-ghost') : null;
    if (!entering && related) return;
    this.hovering = entering;
    this.refresh();
  }

  private menuButton(item: MenuItem): HTMLButtonElement {
    const labels: Record<MenuItem, string> = {
      all: t('codeStudio.editor.menu.accept'),
      word: t('codeStudio.editor.menu.acceptWord'),
      line: t('codeStudio.editor.menu.acceptLine'),
      dismiss: t('codeStudio.editor.menu.dismiss'),
    };
    const button = document.createElement('button');
    button.type = 'button';
    button.tabIndex = -1;
    button.setAttribute('role', 'menuitem');
    button.textContent = labels[item];
    button.dataset.item = item;
    // Like the Accept button, the menu never takes focus from the editor.
    button.addEventListener('pointerdown', (event) => event.preventDefault());
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => this.choose(item));
    return button;
  }

  private openMenu(anchor: HTMLElement): void {
    this.closeMenu();
    const { root } = this.host;
    const menu = document.createElement('div');
    menu.className = 'cm-ghost-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', t('codeStudio.editor.menu.label'));
    menu.append(...MENU_ITEMS.map((item) => this.menuButton(item)));
    const box = root.getBoundingClientRect();
    const at = anchor.getBoundingClientRect();
    menu.style.left = `${at.left - box.left}px`;
    menu.style.top = `${at.bottom - box.top}px`;
    root.append(menu);
    this.menu = menu;
    const outside = (event: PointerEvent) => {
      if (!menu.contains(event.target as Node)) this.closeMenu();
    };
    document.addEventListener('pointerdown', outside, true);
    this.menuStop = () => document.removeEventListener('pointerdown', outside, true);
  }

  closeMenu(): void {
    this.menuStop?.();
    this.menuStop = null;
    this.menu?.remove();
    this.menu = null;
  }
}
