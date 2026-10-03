// Page zoom (ARCHITECTURE.md section 5.3, amendment P2-13; owner WP3). With the page view shown, the commands zoom
// its viewport around its center, and Ctrl+wheel and pinches zoom it around the pointer (viewport/viewport.ts);
// device state remembers each page's zoom. With page.editor off, Phase 2's placeholder page zooms as a whole, and
// keeps its zoom while the app runs. Ctrl+=, Ctrl+-, and Ctrl+0 still change the text size everywhere, so the keys
// for page zoom are Ctrl+Alt+=, Ctrl+Alt+-, and Ctrl+Alt+0.

import { getLocation } from '../../app/location';
import { createStore, useStore } from '../../state/store';
import { t } from '../../strings/t';
import { announce } from '../../ui';
import { stepZoom, zoomPercent } from './viewport/camera';
import { shownFitWidth, shownViewport } from './viewport/shown';

export const ACTUAL_SIZE = 100;
/** One notch of a mouse wheel. Touchpad pinches send many smaller steps, which add up to one. */
const WHEEL_STEP = 100;

/** Phase 2's placeholder page: zoom in percent by page, while page.editor is off. */
const zoomStore = createStore<Readonly<Record<string, number>>>({}, 'pageZoom');

/** The open page, or null when none is open. */
function openPageId(): string | null {
  const location = getLocation();
  return location.view === 'workspace' ? location.pageId : null;
}

export function pageZoomFor(pageId: string | null): number {
  return (pageId && zoomStore.get()[pageId]) || ACTUAL_SIZE;
}

/** The placeholder page's zoom as a hook, in percent. */
export function usePageZoom(pageId: string | null): number {
  return useStore(zoomStore, (zooms) => (pageId && zooms[pageId]) || ACTUAL_SIZE);
}

/** The next command step in either direction, in percent, stopping at 25 and 400. */
export function steppedPageZoom(current: number, direction: 1 | -1): number {
  return zoomPercent(stepZoom(current / 100, direction));
}

function announceZoom(percent: number): void {
  announce(t('page.zoom.announce', { percent }));
}

/** Zooms the open page to `percent` and says so, unless it is already there. Does nothing with no page open. */
export function setPageZoom(percent: number): void {
  const viewport = shownViewport.get();
  if (viewport) {
    if (zoomPercent(viewport.camera().zoom) === percent) return;
    viewport.setZoom(percent / 100);
    return announceZoom(zoomPercent(viewport.camera().zoom));
  }
  const pageId = openPageId();
  if (!pageId || pageZoomFor(pageId) === percent) return;
  zoomStore.set((zooms) => {
    const { [pageId]: _before, ...others } = zooms;
    return percent === ACTUAL_SIZE ? others : { ...others, [pageId]: percent };
  });
  announceZoom(percent);
}

function currentPercent(): number {
  const viewport = shownViewport.get();
  return viewport ? zoomPercent(viewport.camera().zoom) : pageZoomFor(openPageId());
}

export function stepPageZoom(direction: 1 | -1): void {
  setPageZoom(steppedPageZoom(currentPercent(), direction));
}

export function resetPageZoom(): void {
  setPageZoom(ACTUAL_SIZE);
}

/** Zooms so the page's content fits the viewport's width ("Fit width"). */
export function fitPageWidth(): void {
  const fit = shownFitWidth.get();
  if (fit) setPageZoom(zoomPercent(fit()));
}

export function canZoomPage(): boolean {
  return shownViewport.get() !== null || openPageId() !== null;
}

export function canFitPageWidth(): boolean {
  return shownFitWidth.get() !== null;
}

/**
 * Ctrl+wheel over Phase 2's placeholder page zooms it. The page view's own viewport handles the wheel first and
 * stops it, so this only sees the placeholder. Returns a function that stops listening.
 */
export function installPageZoom(view: Window = window): () => void {
  let travel = 0;
  const onWheel = (event: WheelEvent) => {
    if (!event.ctrlKey || event.defaultPrevented) return;
    if (!(event.target instanceof Element) || !event.target.closest('[data-region="page"]')) return;
    event.preventDefault();
    travel += event.deltaY;
    if (Math.abs(travel) < WHEEL_STEP) return;
    stepPageZoom(travel < 0 ? 1 : -1);
    travel = 0;
  };
  view.addEventListener('wheel', onWheel, { passive: false });
  return () => view.removeEventListener('wheel', onWheel);
}
