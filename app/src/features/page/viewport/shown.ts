// The shown page's viewport, in a module light enough for start-up: the zoom commands and Phase 5's seams reach it
// without loading the page view's code or styles.
import { createStore, useStore } from '../../../state/store';
import type { PageViewportApi } from './viewport';

/** The viewport of the page that is shown, for usePageViewport. */
export const shownViewport = createStore<PageViewportApi | null>(null, 'page viewport');

/** The zoom that fits the shown page's content to the viewport's width, set while a page is shown. */
export const shownFitWidth = createStore<(() => number) | null>(null, 'page fit width');

/** What the page commands do to the shown page. Its code loads with the page; the commands load at start-up. */
export interface PageActions {
  /** A caret for a new floating text box, 16 units below the last focused block or at the view's top left. */
  newTextBox(): void;
  layout(): 'freeform' | 'flow';
  setLayout(layout: 'freeform' | 'flow'): void;
  /** Whether the compact Reading view applies: the compact size class. */
  readingAvailable(): boolean;
  reading(): boolean;
  setReading(on: boolean): void;
  /** Runs an object command on the selected blocks. */
  objectCommand(command: ObjectCommandId): void;
  objectEnabled(command: ObjectCommandId): boolean;
}

/** The object commands, by their command ID's last part. */
export type ObjectCommandId =
  | 'bringToFront'
  | 'sendToBack'
  | 'bringForward'
  | 'sendBackward'
  | 'edit'
  | 'delete'
  | 'lock'
  | 'lockPosition'
  | 'unlock'
  | 'float'
  | 'putInFlow'
  | 'sizeAndPosition';

/** The shown page's actions, set while a page is shown. */
export const shownPage = createStore<PageActions | null>(null, 'page actions');

export function usePageViewport(): PageViewportApi | null {
  return useStore(shownViewport, (viewport) => viewport);
}
