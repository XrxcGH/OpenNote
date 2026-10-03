// Opens and closes the linked pages pane. It has no slot in the workspace grid, so it renders in a React root of
// its own beside the page, on first use, like the app's overlays. The page stays usable beside it.
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import styles from '../search.module.css';
import { LinkedPages } from './LinkedPages';

let host: HTMLElement | null = null;
let root: Root | null = null;
let opener: HTMLElement | null = null;

export function isLinkedPagesOpen(): boolean {
  return host !== null;
}

export function closeLinkedPages(): void {
  root?.unmount();
  host?.remove();
  root = null;
  host = null;
  if (opener?.isConnected) opener.focus();
  opener = null;
}

/** Shows the pane, or closes it when it is showing. */
export function toggleLinkedPages(): void {
  if (host) {
    closeLinkedPages();
    return;
  }
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  host = document.body.appendChild(document.createElement('div'));
  host.className = styles.sheet;
  host.dataset.region = 'linked-pages';
  root = createRoot(host);
  root.render(<LinkedPages onClose={closeLinkedPages} />);
}
