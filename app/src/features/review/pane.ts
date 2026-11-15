// The comments pane beside the shown page (ADR 0086). It lists the page's comments in reading order and closes when
// the page changes, as the Page history panel does.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { shownMounted } from '../page';
import { CommentsPane } from './CommentsPane';
import type { PageReview } from './page';
import styles from './review.module.css';

let pane: { host: HTMLElement; root: Root; review: PageReview; returnTo: HTMLElement | null } | null = null;
let stopWatching: (() => void) | null = null;

/** Opens the comments pane for a page's review, or keeps it when it is open for that page. */
export function openPane(review: PageReview): void {
  if (pane?.host.isConnected && pane.review === review) return;
  closePane();
  const parent = review.mounted.viewport.viewport.parentElement;
  if (!parent) return;
  stopWatching ??= shownMounted.subscribe(() => closePane());
  const host = parent.appendChild(document.createElement('div'));
  host.className = styles.pane;
  host.dataset.pagePane = '';
  host.dataset.commentsPane = '';
  const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  pane = { host, root: createRoot(host), review, returnTo };
  pane.root.render(createElement(CommentsPane, { review, onClose: closePane }));
}

export function closePane(): void {
  if (!pane) return;
  const { host, root, returnTo } = pane;
  pane = null;
  const hadFocus = host.contains(document.activeElement);
  root.unmount();
  host.remove();
  if (hadFocus && returnTo?.isConnected) returnTo.focus({ preventScroll: true });
}

export function isPaneOpen(): boolean {
  return pane?.host.isConnected ?? false;
}

/** Shows a comment in the pane once it renders; with `input`, the focus goes to its text box. */
export function focusComment(id: string, input = true): void {
  const tryFocus = (left: number) => {
    const item = pane?.host.querySelector<HTMLElement>(`[data-comment-item="${id.replace(/[^0-9a-z]/g, '')}"]`);
    if (!item) {
      if (left > 0) requestAnimationFrame(() => tryFocus(left - 1));
      return;
    }
    item.scrollIntoView?.({ block: 'nearest' });
    if (input) item.querySelector<HTMLElement>('textarea')?.focus();
  };
  tryFocus(5);
}
