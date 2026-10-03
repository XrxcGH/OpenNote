// The page history chunk (ARCHITECTURE.md section 21): the panel beside the shown page and the commands' work.
// Next change and Previous change move through the comparison. The panel closes when the page changes.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { shownViewport } from '../viewport/viewport';
import { moveToChange } from './CompareView';
import { HistoryPanel } from './HistoryPanel';
import styles from './history.module.css';
import { shownPage } from './shown';

let panel: { host: HTMLElement; root: Root; returnTo: HTMLElement | null } | null = null;
let stopWatching: (() => void) | null = null;

/** Opens the Page history panel for the shown page, or focuses it when it's open. */
export function openHistory(title = ''): void {
  const page = shownPage.get();
  const viewport = shownViewport.get();
  const parent = viewport?.viewport.parentElement;
  if (!page || !parent) return;
  stopWatching ??= shownPage.subscribe(() => closeHistory());
  if (!panel?.host.isConnected) {
    panel?.root.unmount();
    const host = parent.appendChild(document.createElement('div'));
    host.className = styles.host;
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel = { host, root: createRoot(host), returnTo };
    panel.root.render(createElement(HistoryPanel, { page, title, onClose: closeHistory }));
  }
  const host = panel.host;
  requestAnimationFrame(() => host.querySelector<HTMLElement>('button:not(:disabled)')?.focus());
}

export function closeHistory(): void {
  if (!panel) return;
  const { host, root, returnTo } = panel;
  panel = null;
  const hadFocus = host.contains(document.activeElement);
  root.unmount();
  host.remove();
  if (hadFocus && returnTo?.isConnected) returnTo.focus({ preventScroll: true });
}

export function isHistoryOpen(): boolean {
  return panel?.host.isConnected ?? false;
}

/** F8 and Shift+F8 in a comparison. */
export function moveThroughChanges(direction: 1 | -1): void {
  const compare = panel?.host.querySelector('[data-compare]');
  if (!compare) return;
  const moved = moveToChange(compare, direction);
  announce(moved ? t('history.compare.change', moved) : t('history.compare.noMore'));
}

/** Tests start over. */
export function resetHistory(): void {
  closeHistory();
  stopWatching?.();
  stopWatching = null;
}
