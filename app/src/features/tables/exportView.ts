// What the page's exports read of a table block: the sheet model (cell styles, merges, and cached results), the row
// height limits, and the shown text of a number. It starts no editor, worker, or lazy chunk, so the print test bundle
// can hold it in one file (pages/testing/edgeSurface.ts). index.ts passes it on.

import { render } from './engine/numfmt';
import { EN_US } from './engine/locale';

export * as sheetModel from './sheet/model';
export { MAX_HEIGHT, MIN_HEIGHT } from './sheet/structure/lines';

/** The shown text of a number under a number format code, which the page exports use for formula results. */
export const renderNumberFormat = (value: number, code: string): string => render(value, code, EN_US).text;
