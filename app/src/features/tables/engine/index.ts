// The smart-table engine: pure TypeScript with no React or DOM, so it runs in Node tests and a worker.
// The feature's UI reaches it through features/tables/index.ts once the Phase 2 shell and the Phase 3 core land.

export { toCanonical, parseCanonical } from './canonical';
export { daysToIso, excelSerialToDays, parseDate, parseIsoDate, todayDays } from './dates';
export {
  addRow,
  checkFormulaInput,
  createTable,
  deleteRow,
  makeCell,
  setCellInput,
  setColumnFormula,
  setColumnType,
} from './edit';
export type { CellEdit, ColumnInit, FormulaResult } from './edit';
export { filterIndices, viewIndices } from './filter';
export type { FilterCondition, FilterOp, TableView } from './filter';
export { formatValue } from './format';
export { convertFormula, STORED, syntaxOf } from './formula/lexer';
export type { FormulaProblem, Syntax } from './formula/lexer';
export { parseFormula } from './formula/parser';
export { DE_DE, EN_US, FR_FR, parseLocaleNumber } from './locale';
export type { DateOrder, Locale } from './locale';
export { columnLetter, isMismatch, letterToColumn, parseInput } from './model';
export type { Cell, Column, ColumnType, Row, Table, TotalKind } from './model';
export { formatQuickMath, quickMath } from './quickMath';
export type { QuickMathResult } from './quickMath';
export { recalculate, recalculateWithCycles } from './recalc';
export type { CycleCell } from './recalc';
export { sortedIndices, sortTable } from './sort';
export type { SortKey } from './sort';
export { columnTotal, hasTotals, totalsRow } from './totals';
export { ERROR_TOKENS, ERROR_WORDS, err, isError } from './values';
export type { ErrorCode, FormulaError, Value } from './values';

export * from './chart';
export * from './paste';
