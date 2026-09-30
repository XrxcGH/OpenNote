// The app's own context menu in editors (amendment P2-7 from the Phase 4 design). Elements marked data-app-menu
// get the app's menu instead of WebView2's default one. Plain text fields keep the default, with its spelling and
// clipboard items. The page-wide contextmenu handler calls openAppContextMenu for every contextmenu event.
// The attribute's value names a registered builder, so Phase 4 can add spelling suggestions from the app's
// service; without one, the menu offers Cut, Copy, Paste, and Select all.

import { formatChord } from '../commands/keymap';
import type { Chord } from '../commands/types';
import { t } from '../strings/t';
import { fromKeyboard } from './ContextMenu';
import { openMenu } from './Menu';
import type { MenuAnchor, MenuItemSpec } from './Menu';

export interface AppMenuContext {
  /** The element the menu opened on. */
  target: Element;
  /** The nearest element marked data-app-menu. */
  host: HTMLElement;
  anchor: MenuAnchor;
}

export type AppMenuBuilder = (context: AppMenuContext) => { label: string; items: readonly MenuItemSpec[] } | null;

const builders = new Map<string, AppMenuBuilder>();

/** Registers the menu for elements marked data-app-menu="<kind>". Returns a function that removes it. */
export function registerAppMenu(kind: string, build: AppMenuBuilder): () => void {
  if (builders.has(kind)) throw new Error(`An app menu for "${kind}" is already registered.`);
  builders.set(kind, build);
  return () => {
    if (builders.get(kind) === build) builders.delete(kind);
  };
}

type Editable = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

function editableIn(target: Element, host: HTMLElement): Editable | null {
  const field = target.closest<HTMLElement>('input, textarea, [contenteditable]:not([contenteditable="false"])');
  if (field && host.contains(field)) return field;
  return host.isContentEditable ? host : null;
}

function isField(element: Element | null): element is HTMLInputElement | HTMLTextAreaElement {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
}

function hasSelection(editable: Editable | null, host: HTMLElement): boolean {
  if (isField(editable)) return editable.selectionStart !== editable.selectionEnd;
  const selection = document.getSelection();
  return Boolean(selection && !selection.isCollapsed && host.contains(selection.anchorNode));
}

/** The caret or selection, for a menu opened from the keyboard, else the element itself. */
function caretAnchor(host: HTMLElement): MenuAnchor {
  const selection = document.getSelection();
  const rect = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
  return rect && (rect.width || rect.height) ? { x: rect.left, y: rect.bottom } : host;
}

async function paste(): Promise<void> {
  const text = await navigator.clipboard.readText();
  document.execCommand('insertText', false, text);
}

const shortcut = (keys: string) => formatChord(keys as Chord);

/** Cut, Copy, Paste, and Select all for the editable element the menu opened on. */
export function editMenu({ target, host }: AppMenuContext): { label: string; items: readonly MenuItemSpec[] } {
  const editable = editableIn(target, host);
  const selected = hasSelection(editable, host);
  const canPaste = Boolean(editable && !(isField(editable) && editable.readOnly) && navigator.clipboard?.readText);
  const items: MenuItemSpec[] = [
    { id: 'cut', label: t('common.cut'), shortcut: shortcut('Ctrl+X'), disabled: !(editable && selected) },
    { id: 'copy', label: t('common.copy'), shortcut: shortcut('Ctrl+C'), disabled: !selected },
    { id: 'paste', label: t('common.paste'), shortcut: shortcut('Ctrl+V'), disabled: !canPaste },
    { id: 'selectAll', label: t('common.selectAll'), shortcut: shortcut('Ctrl+A'), separatorBefore: true },
  ];
  const run: Record<string, () => void> = {
    cut: () => document.execCommand('cut'),
    copy: () => document.execCommand('copy'),
    paste: () => void paste(),
    selectAll: () => document.execCommand('selectAll'),
  };
  return { label: t('common.editMenu'), items: items.map((item) => ({ ...item, onSelect: run[item.id] })) };
}

/**
 * Opens the app's menu when a contextmenu event starts inside an element marked data-app-menu. Returns true
 * when it handled the event, which it then keeps from opening WebView2's default menu.
 */
export function openAppContextMenu(event: MouseEvent): boolean {
  const target = event.target instanceof Element ? event.target : null;
  const host = target?.closest<HTMLElement>('[data-app-menu]');
  if (!target || !host || event.defaultPrevented) return false;
  event.preventDefault();
  const anchor = fromKeyboard(event) ? caretAnchor(host) : { x: event.clientX, y: event.clientY };
  const menu = (builders.get(host.dataset.appMenu ?? '') ?? editMenu)({ target, host, anchor });
  if (menu?.items.length) void openMenu({ ...menu, anchor });
  return true;
}
