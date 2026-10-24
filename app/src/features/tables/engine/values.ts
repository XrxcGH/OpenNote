// Cell and formula values (DEVELOPMENT.md section 5, Phase 7). Pure module: no DOM, no React.
// A value is a number, text, a boolean, empty (null), or an error. Dates are numbers of days since 1970-01-01.

export type ErrorCode = 'DIV0' | 'VALUE' | 'REF' | 'NAME' | 'NUM' | 'CYCLE';

export interface FormulaError {
  readonly error: ErrorCode;
}

export type Value = number | string | boolean | null | FormulaError;

const ERRORS: Record<ErrorCode, FormulaError> = {
  DIV0: Object.freeze({ error: 'DIV0' }),
  VALUE: Object.freeze({ error: 'VALUE' }),
  REF: Object.freeze({ error: 'REF' }),
  NAME: Object.freeze({ error: 'NAME' }),
  NUM: Object.freeze({ error: 'NUM' }),
  CYCLE: Object.freeze({ error: 'CYCLE' }),
};

/** The text stored in a cache. A cycle uses the reference token, which other tools recognize. */
export const ERROR_TOKENS: Record<ErrorCode, string> = {
  DIV0: '#DIV/0!',
  VALUE: '#VALUE!',
  REF: '#REF!',
  NAME: '#NAME?',
  NUM: '#NUM!',
  CYCLE: '#REF!',
};

/** Plain words shown in a cell in place of the token. */
export const ERROR_WORDS: Record<ErrorCode, string> = {
  DIV0: 'Divide by 0',
  VALUE: 'Not a number',
  REF: 'Missing column',
  NAME: 'Unknown name',
  NUM: 'Invalid result',
  CYCLE: 'Circular',
};

export function err(code: ErrorCode): FormulaError {
  return ERRORS[code];
}

export function isError(value: Value): value is FormulaError {
  return typeof value === 'object' && value !== null;
}

/** Reads an error token such as "#DIV/0!" or its Markdown-escaped form. Returns null for other text. */
export function errorFromToken(text: string): FormulaError | null {
  const token = text.trim().replace(/^\\#/, '#');
  for (const code of ['DIV0', 'VALUE', 'REF', 'NAME', 'NUM'] as const) {
    if (ERROR_TOKENS[code] === token) return ERRORS[code];
  }
  return null;
}

/** Rounds to 15 significant digits, so 0.1 + 0.2 is 0.3. */
export function round15(n: number): number {
  if (n === 0 || !Number.isFinite(n)) return n;
  return Number(n.toPrecision(15));
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

/** Excel-style coercion to a number: empty is 0, booleans are 0 and 1, and other text is an error. */
export function toNumber(value: Value): number | FormulaError {
  if (typeof value === 'number') return value;
  if (value === null) return 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') return parseCanonicalNumber(value) ?? err('VALUE');
  return value;
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
  if (typeof value === 'string') return value;
  if (value === null) return '';
  if (typeof value === 'number') return numberToText(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return value;
}

/** Empty is false, numbers are true unless zero, and only the words TRUE and FALSE count as text. */
export function toBool(value: Value): boolean | FormulaError {
  if (typeof value === 'boolean') return value;
  if (value === null) return false;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const word = value.trim().toUpperCase();
    return word === 'TRUE' ? true : word === 'FALSE' ? false : err('VALUE');
  }
  return value;
}

/** True for a finite number, the only kind aggregates add up. */
export function isNumber(value: Value): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Turns an arithmetic result into a value: not-a-number and infinity become the invalid-number error. */
export function finish(n: number): Value {
  return Number.isFinite(n) ? round15(n) : err('NUM');
}
