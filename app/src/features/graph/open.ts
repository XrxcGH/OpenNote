// Opening the graph view. Its code is a lazy chunk, so it costs nothing at start-up.
import { lazy } from 'react';
import { showOverlay } from '../../shell/commandbar/overlays';

const LazyGraph = lazy(() => import('./GraphView'));

export function openGraph(): void {
  showOverlay('graph', LazyGraph, {});
}
