// Opening the canvas. Its code is a lazy chunk, so it costs nothing at start-up.
import { lazy } from 'react';
import { showOverlay } from '../../shell/commandbar/overlays';

const LazyCanvas = lazy(() => import('./CanvasView'));

export function openCanvas(): void {
  showOverlay('canvas', LazyCanvas, {});
}
