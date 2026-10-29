// Opening the Tags pane. Its code is a lazy chunk, so it costs nothing at start-up.
import { lazy } from 'react';
import { showOverlay } from '../../../shell/commandbar/overlays';

const LazyTagsPane = lazy(() => import('./TagsPane'));

export function openTagsPane(): void {
  showOverlay('search-tags-pane', LazyTagsPane, {});
}
