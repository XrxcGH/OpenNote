// Page zoom (amendment P2-13). Ctrl+wheel over the page region, and a pinch on a touchpad, zoom the page, as in
// OneNote. They leave the interface's text size alone, which zoom.ts in the appearance feature keeps to the rest
// of the window. A page keeps its zoom while the app runs; remembering it across restarts comes with the page's
// view state in Phase 4. Ctrl+=, Ctrl+-, and Ctrl+0 still change the text size everywhere, so the keyboard way
// to zoom a page is through the commands in the palette.

import { getLocation } from '../../app/location';
import { createStore, useStore } from '../../state/store';
import { t } from '../../strings/t';
import { announce } from '../../ui';

export const PAGE_ZOOMS: readonly number[] = [50, 75, 90, 100, 110, 125, 150, 200, 300];
export const ACTUAL_SIZE = 100;
/** One notch of a mouse wheel. Touchpad pinches send many smaller steps, which add up to one. */
const WHEEL_STEP = 100;

const zoomStore = createStore<Readonly<Record<string, number>>>({}, 'pageZoom');

/** The open page, or null when none is open. */
function openPageId(): string | null {
  const location = getLocation();
  return location.view === 'workspace' ? location.pageId : null;
}

export function pageZoomFor(pageId: string | null): number {
  return (pageId && zoomStore.get()[pageId]) || ACTUAL_SIZE;
}

/** A page's zoom as a hook, in percent. */
export function usePageZoom(pageId: string | null): number {
  return useStore(zoomStore, (zooms) => (pageId && zooms[pageId]) || ACTUAL_SIZE);
}

/** The next zoom in the list, in either direction, stopping at the ends. */
export function steppedPageZoom(current: number, direction: 1 | -1): number {
  const index = PAGE_ZOOMS.indexOf(current);
  const from = index === -1 ? PAGE_ZOOMS.indexOf(ACTUAL_SIZE) : index;
  return PAGE_ZOOMS[Math.min(PAGE_ZOOMS.length - 1, Math.max(0, from + direction))];
}

/** Zooms the open page and says so, unless it is already at that zoom. Does nothing with no page open. */
export function setPageZoom(percent: number): void {
  const pageId = openPageId();
  if (!pageId || pageZoomFor(pageId) === percent) return;
  zoomStore.set((zooms) => {
    const { [pageId]: _before, ...others } = zooms;
    return percent === ACTUAL_SIZE ? others : { ...others, [pageId]: percent };
  });
  announce(t('page.zoom.announce', { percent }));
}

export function stepPageZoom(direction: 1 | -1): void {
  setPageZoom(steppedPageZoom(pageZoomFor(openPageId()), direction));
}

export function resetPageZoom(): void {
  setPageZoom(ACTUAL_SIZE);
}

export function canZoomPage(): boolean {
  return openPageId() !== null;
}

/** Ctrl+wheel over the page region zooms the page. Returns a function that stops listening. */
export function installPageZoom(view: Window = window): () => void {
  let travel = 0;
  const onWheel = (event: WheelEvent) => {
    if (!event.ctrlKey) return;
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
