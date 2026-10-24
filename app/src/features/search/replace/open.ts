// Opening Replace. Its code is a lazy chunk, so it costs nothing at start-up.
import { lazy } from 'react';
import { showOverlay } from '../../../shell/commandbar/overlays';

const LazyReplace = lazy(() => import('./ReplaceDialog'));

/** Opens the Replace dialog with the words already in the search box. */
export function openReplace(query = ''): void {
  showOverlay('search-replace', LazyReplace, { query });
}
