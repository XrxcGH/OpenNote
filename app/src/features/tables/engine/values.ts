// Cell and formula values (DEVELOPMENT.md section 5, Phase 7; ADR 0058). Pure module: no DOM, no React.
// A scalar is a number, text, a boolean, empty (null), or an error. Dates are serials: days since 1899-12-30.
// A formula's value may also be an array, a reference to a block of cells, or a lambda. Cells hold scalars only.

import { parseDate } from './dates';

export type ErrorCode =
  'DIV0' | 'VALUE' | 'REF' | 'NAME' | 'NUM' | 'NA' | 'NULL' | 'SPILL' | 'CALC' | 'FIELD' | 'BUSY' | 'CYCLE';

/** Why a function gave an error, where the code alone says too little. 'tooMany': an array past the size cap. */
export type ErrorReason = 'tooMany';

export interface FormulaError {
  readonly error: ErrorCode;
  /** Set only by a function that knows more than the code says. Equal codes are the same error. */
  readonly reason?: ErrorReason;
}

/** What a cell holds. */
export type Scalar = number | string | boolean | null | FormulaError;

/** A block of values in row-major order. Arrays never nest, so every item is a scalar. */
export interface ArrayValue {
  readonly kind: 'array';
  readonly rows: number;
  readonly cols: number;
  readonly data: readonly Scalar[];
}

/** A block of cells in a table, zero-based and inclusive. `table` is unset for the formula's own table. */
export interface RefValue {
  readonly kind: 'ref';
  readonly table?: string;
  readonly r1: number;
  readonly c1: number;
  readonly r2: number;
  readonly c2: number;
}

/** A function value: its parameter names and a body to call with their values. */
export interface LambdaValue {
  readonly kind: 'lambda';
  readonly params: readonly string[];
  readonly call: (args: readonly Value[]) => Value;
}

export type Value = Scalar | ArrayValue | RefValue | LambdaValue;

const ERRORS = Object.fromEntries(
  (['DIV0', 'VALUE', 'REF', 'NAME', 'NUM', 'NA', 'NULL', 'SPILL', 'CALC', 'FIELD', 'BUSY', 'CYCLE'] as const).map(
    (code) => [code, Object.freeze({ error: code })],
  ),
) as Record<ErrorCode, FormulaError>;

/** The text stored in a cache. A cycle uses the reference token, which other tools recognize. */
export const ERROR_TOKENS: Record<ErrorCode, string> = {
  DIV0: '#DIV/0!',
  VALUE: '#VALUE!',
  REF: '#REF!',
  NAME: '#NAME?',
  NUM: '#NUM!',
  NA: '#N/A',
  NULL: '#NULL!',
  SPILL: '#SPILL!',
  CALC: '#CALC!',
  FIELD: '#FIELD!',
  BUSY: '#BUSY!',
  CYCLE: '#REF!',
};

/** Plain words for an error, shown in a tooltip, in the formula bar, and to screen readers. */
export const ERROR_WORDS: Record<ErrorCode, string> = {
  DIV0: 'Divide by 0',
  VALUE: 'Not a number',
  REF: 'Missing column',
  NAME: 'Unknown name',
  NUM: 'Invalid result',
  NA: 'Not available',
  NULL: 'No overlap',
  SPILL: 'No room to spill',
  CALC: 'Cannot calculate',
  FIELD: 'Missing field',
  BUSY: 'Still calculating',
  CYCLE: 'Circular',
};

export function err(code: ErrorCode): FormulaError {
  return ERRORS[code];
}

export function isError(value: Value): value is FormulaError {
  return typeof value === 'object' && value !== null && 'error' in value;
}

export function isArray(value: Value): value is ArrayValue {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'array';
}

export function isRef(value: Value): value is RefValue {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'ref';
}

export function isLambda(value: Value): value is LambdaValue {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'lambda';
}

/** An array from rows of scalars. All rows must be as long as the first. */
export function arrayOf(rows: readonly (readonly Scalar[])[]): ArrayValue {
  return { kind: 'array', rows: rows.length, cols: rows[0]?.length ?? 0, data: rows.flat() };
}

/**
 * The scalar a value stands for where one value is needed. An array gives its top-left item, as Excel does when
 * an array meets a single cell. A reference or a lambda cannot be read here, so it gives #VALUE! and #CALC!: the
 * evaluator reads references before they get this far.
 */
export function toScalar(value: Value): Scalar {
  if (typeof value !== 'object' || value === null || 'error' in value) return value;
  if (value.kind === 'array') return value.data[0] ?? null;
  return value.kind === 'lambda' ? ERRORS.CALC : ERRORS.VALUE;
}

const CODES = Object.keys(ERROR_TOKENS).filter((code) => code !== 'CYCLE') as ErrorCode[];

/** Reads an error token such as "#DIV/0!" or its Markdown-escaped form. Returns null for other text. */
export function errorFromToken(text: string): FormulaError | null {
  const token = text.trim().replace(/^\\#/, '#');
  for (const code of CODES) {
    if (ERROR_TOKENS[code] === token) return ERRORS[code];
  }
  return null;
}

/** Rounds to 15 significant digits, the most a spreadsheet shows and compares. */
export function round15(n: number): number {
  if (n === 0 || !Number.isFinite(n)) return n;
  return Number(n.toPrecision(15));
}

/**
 * Keeps the first 15 significant digits of a typed number and sets the rest to 0, as Excel does with typed input:
 * 12345678901234567890 becomes 12345678901234500000. `text` is plain decimal or exponent text.
 */
export function truncate15(text: string): number {
  const match = /^([+-]?)(\d*)\.?(\d*)(?:e([+-]?\d+))?$/i.exec(text.trim());
  if (!match) return Number(text);
  const [, sign, whole, fraction, exponent] = match;
  const digits = (whole + fraction).replace(/^0+/, '');
  if (digits.length <= 15) return Number(text);
  const lead = whole.replace(/^0+/, '');
  // The power of ten of the first significant digit.
  const zeros = fraction.length - fraction.replace(/^0+/, '').length;
  const power = (lead.length > 0 ? lead.length - 1 : -zeros - 1) + Number(exponent ?? 0);
  return Number(`${sign}${digits[0]}.${digits.slice(1, 15)}e${power}`);
}

/** The locale-free text of a number: 15 significant digits, written as ECMAScript writes it. */
export function numberToText(n: number): string {
  const rounded = round15(n);
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

/** One way to read each number, so a long run of digits cannot make the pattern backtrack. */
const CANONICAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

/** Longer text is never number text this engine wrote, and formulas read text cells on every recalculation. */
const MAX_NUMBER_TEXT = 400;

/** Reads canonical number text, with or without Markdown escapes. Returns null when it isn't one. */
export function parseCanonicalNumber(text: string): number | null {
  if (text.length > MAX_NUMBER_TEXT) return null;
  const plain = text.trim().replace(/\\([-+.])/g, '$1');
  return CANONICAL_NUMBER.test(plain) ? Number(plain) : null;
}

/** A number with optional grouping commas: 1234, 1,234.5, .5. Each group is exactly three digits. */
const PLAIN = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+`;
/** Money and percent: an optional sign, a currency sign before or after, and a percent sign at the end. */
const MONEY = new RegExp(
  String.raw`^([+-]?)\s*([$€£¥]?)\s*([+-]?)\s*(${PLAIN})(?:e([+-]?\d+))?\s*([$€£¥]?)\s*(%?)$`,
  'i',
);
/** A whole number and a fraction: 1 1/2. */
const FRACTION = /^([+-]?)(\d+)\s+(\d+)\/(\d+)$/;
/** A time of day: 1:30, 13:45:10, 1:30 PM, 0:00:01.5. */
const TIME = /^(\d{1,4}):(\d{1,2})(?::(\d{1,2}(?:\.\d+)?))?\s*([AP]M)?$/i;

function moneyOrPercent(text: string): number | null {
  const m = MONEY.exec(text);
  if (!m) return null;
  const [, sign1, before, sign2, digits, exponent, after, percent] = m;
  // Excel refuses a currency sign together with a percent sign ("$5%" is #VALUE!).
  if ((before && after) || (sign1 && sign2) || ((before || after) && percent)) return null;
  const n = Number(digits.replace(/,/g, '')) * 10 ** Number(exponent ?? 0);
  const signed = sign1 === '-' || sign2 === '-' ? -n : n;
  return percent ? signed / 100 : signed;
}

function fraction(text: string): number | null {
  const m = FRACTION.exec(text);
  if (!m) return null;
  const [whole, top, bottom] = [Number(m[2]), Number(m[3]), Number(m[4])];
  if (bottom === 0) return null;
  const n = whole + top / bottom;
  return m[1] === '-' ? -n : n;
}

function timeOfDay(text: string): number | null {
  const m = TIME.exec(text);
  if (!m) return null;
  let hour = Number(m[1]);
  const [minute, second] = [Number(m[2]), Number(m[3] ?? 0)];
  if (minute > 59 || second >= 60) return null;
  if (m[4]) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (m[4].toUpperCase() === 'PM' ? 12 : 0);
  }
  return (hour * 3600 + minute * 60 + second) / 86400;
}

/**
 * Reads text that a spreadsheet takes as a number in arithmetic: plain and grouped numbers, accounting brackets for
 * a negative, currency ("$5"), percent ("50%" is 0.5), a whole number and a fraction ("1 1/2"), a time ("1:30"),
 * and a date ("2026-01-02", "Jan 2, 2026", "1/2/2026" month first). Returns null for other text.
 */
export function textToNumber(text: string): number | null {
  if (text.length > MAX_NUMBER_TEXT) return null;
  const n = readNumberText(text.trim());
  // Digits too long for a number ("1e999") are not a number, so no function reads Infinity from text.
  return n !== null && Number.isFinite(n) ? n : null;
}

function readNumberText(plain: string): number | null {
  if (plain === '') return null;
  const canonical = parseCanonicalNumber(plain);
  if (canonical !== null) return canonical;
  const bracketed = /^\((.*)\)$/.exec(plain);
  if (bracketed) {
    const inner = moneyOrPercent(bracketed[1].trim());
    return inner === null || inner < 0 ? null : -inner;
  }
  return moneyOrPercent(plain) ?? fraction(plain) ?? timeOfDay(plain) ?? parseDate(plain, 'mdy');
}

/**
 * Excel's coercion to a number. Empty is 0. FALSE is 0 and TRUE is 1. Text that reads as a number is that number
 * (textToNumber), and other text is #VALUE!. An array gives its top-left item.
 */
export function toNumber(value: Value): number | FormulaError {
  const v = toScalar(value);
  if (typeof v === 'number') return v;
  if (v === null) return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') return textToNumber(v) ?? err('VALUE');
  return v;
}

/** Coerces every argument to a number, or returns the first error. */
export function toNumbers(args: readonly Value[]): number[] | FormulaError {
  const out: number[] = [];
  for (const v of args) {
    const n = toNumber(v);
    if (typeof n !== 'number') return n;
    out.push(n);
  }
  return out;
}

export function toText(value: Value): string | FormulaError {
  const v = toScalar(value);
  if (typeof v === 'string') return v;
  if (v === null) return '';
  if (typeof v === 'number') return numberToText(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return v;
}

/** Empty is false, numbers are true unless zero, and only the words TRUE and FALSE count as text. */
export function toBool(value: Value): boolean | FormulaError {
  const v = toScalar(value);
  if (typeof v === 'boolean') return v;
  if (v === null) return false;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const word = v.trim().toUpperCase();
    return word === 'TRUE' ? true : word === 'FALSE' ? false : err('VALUE');
  }
  return v;
}

/** True for a finite number, the only kind aggregates add up. */
export function isNumber(value: Value): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Turns an arithmetic result into a value: not-a-number and infinity become the invalid-number error. Results keep
 * every bit of the double (ADR 0058); 15 digits are only what a cell shows and what = compares.
 */
export function finish(n: number): Scalar {
  return Number.isFinite(n) ? n : err('NUM');
}

/** 2^-48: two results this close, relative to their size, differ only by rounding in the last digits. */
const NEAR = 2 ** -48;

/**
 * Excel's rule for a formula whose last operation adds or subtracts: a result within rounding error of zero is 0,
 * so =0.5-0.4-0.1 is 0 while =1*(0.5-0.4-0.1) keeps its tiny remainder. `a` and `b` are the two operands, with `b`
 * already negated for a subtraction.
 */
export function nearZero(a: number, b: number): number {
  const sum = a + b;
  if (sum === 0 || !Number.isFinite(sum)) return sum;
  return Math.abs(sum) < Math.max(Math.abs(a), Math.abs(b)) * NEAR ? 0 : sum;
}
