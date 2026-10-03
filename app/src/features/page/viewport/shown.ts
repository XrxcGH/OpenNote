// The shown page's viewport, in a module light enough for start-up: the zoom commands and Phase 5's seams reach it
// without loading the page view's code or styles.
import { createStore, useStore } from '../../../state/store';
import type { PageViewportApi } from './viewport';

/** The viewport of the page that is shown, for usePageViewport. */
export const shownViewport = createStore<PageViewportApi | null>(null, 'page viewport');

/** The zoom that fits the shown page's content to the viewport's width, set while a page is shown. */
export const shownFitWidth = createStore<(() => number) | null>(null, 'page fit width');

export function usePageViewport(): PageViewportApi | null {
  return useStore(shownViewport, (viewport) => viewport);
}
