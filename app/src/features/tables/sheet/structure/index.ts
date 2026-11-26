// Structure of a table: row heights, auto-fit, distribute, hiding lines, freeze panes, outline groups, insert and
// delete cells, and reference adjustment when lines change (ADR 0056, DESIGN 3.1, 6.8, 13.2).

export * from './edit';
export * from './lines';
export * from './outline';
export * from './fit';
export * from './cells';
export { applyStructureOp } from './ops';
export { followReferences } from './hooks';
export { reflowSheet, rewriteCells, shiftFormula, moveEntries } from './reflow';
export type { Shift } from './reflow';
