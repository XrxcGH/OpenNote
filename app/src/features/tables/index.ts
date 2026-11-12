// The smart-table feature's public face (Phases 7): the engine, and what the page's table block loads to make a
// table smart. The page imports this on first use, so formulas and charts cost nothing until a table is shown.
export * from './engine';
export { attachSmart } from './smart/attach';
export { runSmartCommand } from './smart/commands';
export type { SmartCommand } from './smart/commands';
export { exportTableCharts } from './smart/exportCharts';
/** The cell format bar loads on demand, so the tables chunk stays small. */
export const loadCellFormatBar = () => import('./ui/toolbar/CellFormatBar');
export type { CellFormatBarProps } from './ui/toolbar';
// The sheet model of a table block, which the page's exports read (cell styles, merges, and cached results).
export * as sheetModel from './sheet/model';
// The structure commands and the reference adjustment register themselves with the table commands of the editor.
import './sheet/structure/hooks';
export { readSheet, tableName } from './sheet/model';
export { canvasMeasure } from './sheet/structure/fit';
export { MAX_HEIGHT, MIN_HEIGHT, rowHeight } from './sheet/structure/lines';
// The shown text of a number under a number format code, which the page exports use for formula results.
import { render } from './engine/numfmt';
import { EN_US } from './engine/locale';
export const renderNumberFormat = (value: number, code: string): string => render(value, code, EN_US).text;
