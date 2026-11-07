// The smart-table engine: pure TypeScript with no React or DOM, so it runs in Node tests and a worker.
// The feature's UI reaches it through features/tables/index.ts once the Phase 2 shell and the Phase 3 core land.

export {
  CHOICE_SEPARATOR,
  MAX_CHOICES,
  MAX_CHOICE_NAME,
  choiceIndex,
  choiceRank,
  cleanChoiceName,
  joinChoices,
  splitChoices,
} from './choice';
export { toCanonical, parseCanonical } from './canonical';
export { daysToIso, excelSerialToDays, parseDate, parseIsoDate, todayDays } from './dates';
export {
  addRow,
  calculateTable,
  checkFormulaInput,
  createTable,
  deleteRow,
  deleteRows,
  insertRows,
  makeCell,
  moveRows,
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
export { columnLetter, isMismatch, ITERATE_DEFAULTS, letterToColumn, parseInput } from './model';
export type { Cell, Column, ColumnType, IterateSettings, Row, Table, TableName, TotalKind } from './model';
export { formatQuickMath, quickMath } from './quickMath';
export type { QuickMathResult } from './quickMath';
// Keep one EngineEnv object per page: recalculateCells and recalculateBookCells compare it by identity, and a new
// object rebuilds the page from scratch (ADR 0065).
export {
  errorOrigin,
  needsCalculation,
  recalculate,
  recalculateCells,
  recalculateWithCycles,
  spillRange,
} from './recalc';
export type { CellRef, CycleCell, EngineEnv } from './recalc';
export { explainOrigin, originSentence } from './formula/explain';
export type { ErrorOrigin, OriginCell, OriginSentence, OriginSentenceValues } from './formula/explain';
export { adjustFormula, adjustNames, adjustTable } from './refactor';
export type { AdjustOptions, StructureChange } from './refactor';
export {
  bookCycles,
  bookErrorOrigin,
  bookSpillRange,
  changeBookRows,
  recalculateBook,
  recalculateBookCells,
  setBookCellInput,
  tableNames,
} from './workbook';
export type { Workbook } from './workbook';
export { sortedIndices, sortTable } from './sort';
export type { SortKey } from './sort';
export { columnTotal, hasTotals, totalsRow } from './totals';
export { ERROR_TOKENS, ERROR_WORDS, err, isError } from './values';
export type { ErrorCode, FormulaError, Value } from './values';

export * from './chart';
export * from './paste';
