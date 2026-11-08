// The smart-table feature's public face (Phases 7): the engine, and what the page's table block loads to make a
// table smart. The page imports this on first use, so formulas and charts cost nothing until a table is shown.
export * from './engine';
export { attachSmart } from './smart/attach';
export { runSmartCommand } from './smart/commands';
export type { SmartCommand } from './smart/commands';
export { exportTableCharts } from './smart/exportCharts';
// The structure commands and the reference adjustment register themselves with the table commands of the editor.
import './sheet/structure/hooks';
export { readSheet, tableName } from './sheet/model';
export { canvasMeasure } from './sheet/structure/fit';
