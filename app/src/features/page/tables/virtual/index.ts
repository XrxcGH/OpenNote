// Row virtualization for tables of more than 2,000 rows (DESIGN.md section 18; docs/perf/tables.md).
export { drawnRows, setPinnedRows, virtualRowsKey } from './key';
export type { VirtualRowsState } from './key';
export { revealRow, setRowWindow, virtualRowsPlugin } from './plugin';
export { isVirtualCount, isVirtualDoc, staticDocOf, VIRTUAL_ROW_THRESHOLD } from './rows';
