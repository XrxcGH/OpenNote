// The contract of the function library (ADR 0060). Each family of functions is one file in this folder that exports
// a list of FnSpec2, and fn/index.ts collects them. A family file is edited only by the lane that owns it, so lanes
// never touch the same file. The descriptions people read (one line per function, one per argument) live in
// app/src/strings/en/fn<Family>.ts under the function's name, written fresh in our own words.

import {
  isError,
  isNumber,
  type FormulaError,
  type RefValue,
  type RowState,
  type Scalar,
  type Value,
} from '../../values';

/** What the formula engine gives every function. */
export interface Env {
  /** Today as a serial, read when a formula is calculated. */
  today: () => number;
  /** The page's title, which CELL("filename") returns. Unset gives an empty text, as an unsaved workbook does. */
  title?: string;
  /** What the engine knows about the formula's cell and page. Set only for a function with `refArgs`. */
  probe?: Probe;
  /** Whether a row of a table (by its index on the page) shows. Unset: every row shows. */
  rowState?: (sheet: number, row: number) => RowState;
  /**
   * Which cells of a block (table index, first row, first column, last row, last column) are nested subtotals: their
   * formula calls SUBTOTAL or AGGREGATE. Row-major flags, or undefined when none is. Unset: none is.
   */
  subtotalsIn?: (sheet: number, r1: number, c1: number, r2: number, c2: number) => readonly boolean[] | undefined;
  /** The cell the formula runs in. Set only for a function with `wantsCaller`. */
  caller?: Caller;
}

/** The calling cell, for ROW() and COLUMN() without an argument, INDIRECT's R1C1 text, and FORMULATEXT. */
export interface Caller {
  /** Zero-based row and column of the cell being calculated. */
  readonly row: number;
  readonly col: number;
  /** The formula of a reference's top-left cell in stored form, without "=". Null when it holds none. */
  formulaAt(ref: RefValue): string | null;
}

/** One cell as functions about cells see it (CELL, ISFORMULA). */
export interface ProbeCell {
  /** The cell's value. Empty cells are null. */
  readonly value: Scalar;
  /** True when the cell holds a formula, alone, or through its calculated column. */
  readonly formula: boolean;
  /** The column's type, such as "number" or "date". */
  readonly type: string;
  /** The column's decimal places, when set. */
  readonly decimals?: number;
}

/** The look at the page that the engine lends to a function with `refArgs`. */
export interface Probe {
  /** The formula's own table, zero-based. */
  readonly sheet: number;
  /** The name of every table on the page, in order. */
  readonly sheets: readonly string[];
  /** The cell the formula is in. */
  readonly self: RefValue;
  readonly calc: 'auto' | 'manual';
  /** The table a reference names, zero-based, or -1 when it names none. */
  sheetOf(ref: RefValue): number;
  /** The cell at the top left of a reference, or undefined when it lies outside the table. */
  cell(ref: RefValue): ProbeCell | undefined;
}

/**
 * How an argument reaches a function.
 * - value: any value. The function coerces it itself.
 * - number, text, bool: one value the function reads as that kind.
 * - range: every cell of a reference, or a value typed directly (see `direct`).
 * - array: an array. A single value comes as a one-by-one array.
 * - ref: a reference as a RefValue, unions included. Other values come as they are.
 * - lambda: a function value, made by LAMBDA.
 * - lazy: not evaluated until the function asks, as IF's branches are.
 */
export type ParamKind = 'value' | 'number' | 'text' | 'bool' | 'range' | 'array' | 'ref' | 'lambda' | 'lazy';

export interface Param {
  /** The argument's name in the signature, such as "number" or "digits". */
  readonly name: string;
  readonly kind: ParamKind;
  /** May be left out. Every parameter after an optional one is optional too. */
  readonly optional?: boolean;
  /** The value an omitted argument takes. */
  readonly default?: Value;
  /**
   * For a range: how a value typed directly in the call counts. 'number' (the default) reads text as a number and
   * TRUE as 1, as SUM("3",TRUE) is 4; 'raw' keeps the value as it is, as COUNTA counts it.
   */
  readonly direct?: 'number' | 'raw';
  /** For an array: text in a referenced cell counts as empty, as the logical functions skip it. Typed text still counts. */
  readonly skipRefText?: boolean;
  /** A typed lone text reaches the function as a scalar, not as a one-element array. */
  readonly loneText?: boolean;
  /** For a range: a reference arrives with the state of each row (`ArrayValue.rowState`), as SUBTOTAL reads it. */
  readonly rowState?: boolean;
  /**
   * For a range or array: a reference is resized to the shape of the reference given to the parameter at this index,
   * from its top-left corner, as SUMIF reads a sum range smaller or larger than the tested range.
   */
  readonly resizeTo?: number;
}

/** Parameters that repeat together: value1, value2, and on, or criteria range and criteria pairs. */
export interface ParamGroup {
  readonly repeat: readonly Param[];
  /** The fewest times the group appears. Default 0. */
  readonly min?: number;
}

/** The families, one file each. The design's function table lists what each one holds. */
export type Family =
  | 'math'
  | 'arrays'
  | 'stats'
  | 'statsCompat'
  | 'finance'
  | 'text'
  | 'regex'
  | 'datetime'
  | 'lookup'
  | 'logical'
  | 'info'
  | 'engineering'
  | 'database'
  | 'sheetsCompat';

/** What autocomplete and the Insert Function dialog show besides the description strings. */
export interface FnMeta {
  /** The call with its arguments, in our own notation: optional ones in brackets, repeats with "...". */
  readonly signature: string;
  /** An example of our own, with its result. */
  readonly example: string;
}

export interface FnSpec2 {
  /** The name in capitals, as formulas store it. */
  readonly name: string;
  readonly family: Family;
  readonly params: readonly (Param | ParamGroup)[];
  /** Recalculates on every change, as TODAY and RAND do. */
  readonly volatile?: boolean;
  /** Returns a reference rather than a value, as OFFSET and INDEX do. */
  readonly returnsRef?: boolean;
  /**
   * Array parameters get a reference as a reference (a RefValue) instead of its values, and `env.probe` is set. For
   * functions that ask about a cell rather than its content, as ISREF and CELL do.
   */
  readonly refArgs?: boolean;
  /** Gets the calling cell in `env.caller`. */
  readonly wantsCaller?: boolean;
  /** An error argument reaches the function instead of becoming its result. */
  readonly handlesErrors?: boolean;
  /** Computes the result. A function with lazy parameters is evaluated by the compiler itself and never runs this. */
  readonly run: (args: Value[], env: Env) => Value;
  readonly meta: FnMeta;
}

export function isGroup(param: Param | ParamGroup): param is ParamGroup {
  return 'repeat' in param;
}

/** The fewest and most arguments a function takes. Infinity when a group repeats. */
export function arity(spec: FnSpec2): { min: number; max: number } {
  let min = 0;
  let max = 0;
  for (const param of spec.params) {
    if (isGroup(param)) {
      min += (param.min ?? 0) * param.repeat.length;
      max = Infinity;
    } else {
      if (param.optional !== true) min += 1;
      max += 1;
    }
  }
  return { min, max };
}

/** Every parameter, with each group's parameters once. */
export function paramsOf(spec: FnSpec2): Param[] {
  return spec.params.flatMap((param) => (isGroup(param) ? [...param.repeat] : [param]));
}

/** True when the compiler must evaluate the function itself, because an argument is lazy. */
export function isSpecial(spec: FnSpec2): boolean {
  return paramsOf(spec).some((param) => param.kind === 'lazy');
}

/** The numbers among an aggregate's values, or the first error. Text, booleans, and empty cells are skipped. */
export function numbersIn(values: readonly Value[]): number[] | FormulaError {
  const out: number[] = [];
  for (const v of values) {
    if (isError(v)) return v;
    if (isNumber(v)) out.push(v);
  }
  return out;
}
