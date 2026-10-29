// Opening the search panel. Its code is a lazy chunk, so it costs nothing at start-up.
import { lazy } from 'react';
import { closeOverlay, openOverlay, showOverlay } from '../../shell/commandbar/overlays';

const LazyPanel = lazy(() => import('./SearchPanel'));

export const SEARCH_OVERLAY = 'search';

/** Opens the search panel, or closes it when it is already open. `query` fills the box. */
export function openSearchPanel(query = ''): void {
  if (openOverlay() === SEARCH_OVERLAY && query === '') {
    closeOverlay();
    return;
  }
  showOverlay(SEARCH_OVERLAY, LazyPanel, { query });
}
