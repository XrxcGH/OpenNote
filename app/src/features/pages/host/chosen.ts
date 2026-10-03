// The lasso's selection as a `Selection` of the shown page. The lasso leaves the picked blocks and strokes in the page
// selection store; this turns them into the crop that picture, PDF, Word, copy, and element features share.
import { pageSelection } from '../../page';
import { selectChosen } from '../selection';
import type { Selection } from '../selection';
import { blockBoxes } from './picture';
import type { PageSource } from './source';

/** True when something is picked on the page. */
export function hasChosen(): boolean {
  const { blocks, strokes } = pageSelection.get();
  return blocks.length + strokes.length > 0;
}

/** The selection of the picked blocks and strokes, or null when nothing placeable is picked. */
export function chosenSelection(source: PageSource): Selection | null {
  const { blocks, strokes } = pageSelection.get();
  return selectChosen(source.page, { blocks, strokes }, { boxes: blockBoxes() });
}
