// Opening collections. Their code is a lazy chunk, so it costs nothing at start-up.
import { lazy } from 'react';
import { showOverlay } from '../../shell/commandbar/overlays';

const LazyCollections = lazy(() => import('./CollectionsDialog'));

export function openCollections(): void {
  showOverlay('collections', LazyCollections, {});
}
