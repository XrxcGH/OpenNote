// The calculator's public face: the expression engine, number formatting, the session, and unit conversion.
// No expression is ever run as code, and nothing here touches the DOM.

export { CONSTANTS, findConstant } from './constants';
export type { Constant } from './constants';
export { DEFAULT_CONTEXT, calculate } from './evaluate';
export type { EvalContext } from './evaluate';
export type { CalcError, CalcErrorCode, CalcResult } from './errors';
export { formatNumber } from './format';
export type { FormatOptions, Notation } from './format';
export { FUNCTIONS } from './functions';
export { CALCULATOR, MAX_LENGTH } from './dialect';
export { DEFAULT_REGION, NOTES, evaluateNotes, notesDialect } from './notes';
export type { NotesOptions, NotesRegion } from './notes';
export {
  MAX_HISTORY,
  MEMORY_SLOTS,
  clearHistory,
  lastAnswer,
  memoryAdd,
  memoryClear,
  memoryStore,
  newSession,
  restoreSession,
  setAngleMode,
  submit,
} from './session';
export type { CalcSession, HistoryEntry } from './session';
export type { AngleMode } from '../../../core/expr';
export { calculatorUnits } from './unitSystem';
export { UNIT_CATEGORIES, convert, convertText, findUnit, parseConversion, unitsIn } from './units';
export type { ConvertFailure, ConvertResult, UnitCategory, UnitDef } from './units';
