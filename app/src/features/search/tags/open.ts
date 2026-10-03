// Opening the tags dialog. Its code is a lazy chunk.
import { lazy } from 'react';
import { showOverlay } from '../../../shell/commandbar/overlays';

const LazyTags = lazy(() => import('./TagsDialog'));

export function openTags(): void {
  showOverlay('search-tags', LazyTags, {});
}
