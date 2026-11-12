// What the page's exports read of a table block: the parts of the sheet model they use (cell styles, merges, and
// cached results), the row height limits, and the shown text of a number. It starts no editor, worker, or lazy
// chunk, so the print test bundle can hold it in one file (pages/testing/edgeSurface.ts). index.ts passes it on.
// Named parts, not the whole model, so a feature that imports the tables index carries only what it uses.

import { render } from './engine/numfmt';
import { EN_US } from './engine/locale';
import { activeMerges, cachedValue, fingerprint, readableText, resolve } from './sheet/model';

export type { Box as SheetBox, CellStyle as SheetCellStyle, TableLike as SheetTableLike } from './sheet/model';
export { MAX_HEIGHT, MIN_HEIGHT } from './sheet/structure/lines';

/** The sheet model functions the exports call. */
export const sheetModel = { activeMerges, cachedValue, fingerprint, readableText, resolve };

/** The shown text of a number under a number format code, which the page exports use for formula results. */
export const renderNumberFormat = (value: number, code: string): string => render(value, code, EN_US).text;
