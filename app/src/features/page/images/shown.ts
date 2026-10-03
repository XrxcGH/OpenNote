// The shown page view and its shown images, for the image and paste commands, in a module light enough for
// start-up. attachPageMedia sets the page; the image block renderer keeps the image IDs.
import { createStore } from '../../../state/store';
import type { MountedPage } from '../mount';
import { pageSelection } from '../seams/selectionStore';

export const shownMedia = createStore<MountedPage | null>(null, 'shown page media');

/** The image blocks the shown page has on screen. */
export const shownImageIds = new Set<string>();

/** Whether exactly one image, and nothing else, is selected. */
export function oneImageSelected(): boolean {
  const { blocks, strokes } = pageSelection.get();
  return blocks.length === 1 && strokes.length === 0 && shownImageIds.has(blocks[0]);
}
