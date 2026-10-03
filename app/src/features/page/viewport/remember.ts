// Each page's place on this device (P2-9, FEATURES.md "Remember position"; owner WP3): its zoom and scroll come
// back when it opens, and are saved whenever the camera settles. Pinch and Ctrl+wheel zooms are announced when
// they settle, and command zooms announce themselves.
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { pageView, savePageView } from '../runtime';
import { clampZoom, zoomPercent } from './camera';
import type { PageViewport } from './viewport';

/** Zooms and scrolls to where the page was last shown. Call it before the blocks render. */
export function restoreView(pageId: string, viewport: PageViewport): void {
  const saved = pageView(pageId);
  if (!saved) return;
  const zoom = clampZoom(saved.zoom);
  const seen = viewport.camera().viewport;
  viewport.zoomAt(zoom, { x: seen.x, y: seen.y }, 'commandZoom');
  // Blocks below the viewport may not have their heights yet, so the world makes room for the saved place first.
  viewport.setContent({ w: (saved.scrollX + seen.w) / zoom, h: (saved.scrollY + seen.h) / zoom });
  viewport.scrollTo(saved.scrollX, saved.scrollY);
}

/** Saves the page's place whenever the camera settles. Returns a function that stops. */
export function rememberView(pageId: string, viewport: PageViewport): () => void {
  const stopCamera = viewport.onCamera((camera) => {
    if (camera.gesture) return;
    savePageView(pageId, { scrollX: camera.scrollX, scrollY: camera.scrollY, zoom: camera.zoom });
  });
  const stopGesture = viewport.onGesture((phase, kind) => {
    if (phase !== 'end' || (kind !== 'pinch' && kind !== 'wheelZoom')) return;
    announce(t('page.zoom.announce', { percent: zoomPercent(viewport.camera().zoom) }));
  });
  return () => {
    stopCamera();
    stopGesture();
  };
}
