// Criteria as COUNTIF, SUMIF, AVERAGEIF, the IFS variants, and the database functions read them. The math,
// statistical, database, and lookup families share them. Written from the documented behavior.
//
// A criterion is a value or text. Text may start with an operator: =, <>, <, >, <=, >=. No operator means =.
// A number matches equal numbers. Text that reads as a number, a date, a time, or a percent compares as that number,
// so ">2026-01-01" and ">=50%" work.
//
// Text matches text without regard to case, with the wildcards * (any run of characters) and ? (one character). A
// tilde makes the next character literal: "~*" matches an asterisk.
//
// "=" matches empty cells only. "<>" matches every cell that is not empty. "" matches empty cells and empty text. An
// empty criterion, such as a reference to an empty cell, is read as 0.
//
// TRUE and FALSE match booleans, and an error token such as "#N/A" matches that error. The operators <, >, <=, and >=
// compare numbers with numbers and text with text. Other kinds never match them.

import { errorFromToken, isError, textToNumber, round15, type Scalar } from '../../values';

export type Criterion = (value: Scalar) => boolean;

type Op = '=' | '<>' | '<' | '>' | '<=' | '>=';

const OPERATORS: readonly Op[] = ['<=', '>=', '<>', '<', '>', '='];

function splitOperator(text: string): { op: Op; operand: string; written: boolean } {
  for (const op of OPERATORS) if (text.startsWith(op)) return { op, operand: text.slice(op.length), written: true };
  return { op: '=', operand: text, written: false };
}

function compare(op: Op, order: number): boolean {
  switch (op) {
    case '=':
      return order === 0;
    case '<>':
      return order !== 0;
    case '<':
      return order < 0;
    case '>':
      return order > 0;
    case '<=':
      return order <= 0;
    case '>=':
      return order >= 0;
  }
}

const STAR = 0;
const ONE = 1;
type Token = string | typeof STAR | typeof ONE;

/**
 * A wildcard pattern as a test of the whole text, without regard to case. It runs in time linear in the pattern
 * times the text, never exponential: a mismatch goes back only to the last star, which is enough for globs.
 */
export function wildcardMatcher(pattern: string): (text: string) => boolean {
  const tokens: Token[] = [];
  const chars = Array.from(pattern.toLowerCase());
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (char === '~' && i + 1 < chars.length && '*?~'.includes(chars[i + 1])) tokens.push(chars[++i]);
    else if (char === '*') {
      if (tokens[tokens.length - 1] !== STAR) tokens.push(STAR);
    } else if (char === '?') tokens.push(ONE);
    else tokens.push(char);
  }
  return (value) => {
    const text = Array.from(value.toLowerCase());
    let p = 0;
    let t = 0;
    let starP = -1;
    let starT = 0;
    while (t < text.length) {
      const token = tokens[p];
      if (p < tokens.length && (token === ONE || token === text[t])) {
        p++;
        t++;
      } else if (token === STAR) {
        starP = p++;
        starT = t;
      } else if (starP >= 0) {
        p = starP + 1;
        t = ++starT;
      } else return false;
    }
    while (tokens[p] === STAR) p++;
    return p === tokens.length;
  };
}

/** True when the text has a wildcard that is not escaped. */
export function hasWildcard(pattern: string): boolean {
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '~') i++;
    else if (pattern[i] === '*' || pattern[i] === '?') return true;
  }
  return false;
}

function numberCriterion(op: Op, target: number): Criterion {
  const want = round15(target);
  return (value) => {
    if (typeof value === 'number') return compare(op, Math.sign(round15(value) - want));
    // Text that reads as the number counts as equal; other kinds are simply not equal.
    if (op === '=' || op === '<>') {
      const read = typeof value === 'string' ? textToNumber(value) : null;
      const equal = read !== null && round15(read) === want;
      return op === '=' ? equal : !equal;
    }
    return false;
  };
}

function textCriterion(op: Op, operand: string): Criterion {
  if (op === '=' || op === '<>') {
    const matches = hasWildcard(operand) ? wildcardMatcher(operand) : null;
    const plain = operand.replace(/~([*?~])/g, '$1').toLowerCase();
    const equal = (value: Scalar): boolean => {
      if (typeof value !== 'string') return false;
      return matches ? matches(value) : value.toLowerCase() === plain;
    };
    return op === '=' ? equal : (value) => !equal(value);
  }
  const target = operand.toLowerCase();
  return (value) => {
    if (typeof value !== 'string') return false;
    const text = value.toLowerCase();
    return compare(op, text < target ? -1 : text > target ? 1 : 0);
  };
}

/** Excel's documented limit on the length of criteria text. Longer criteria match nothing. */
export const CRITERIA_MAX_LENGTH = 255;

/** Reads a criterion into a test of one cell's value. */
export function parseCriterion(criterion: Scalar): Criterion {
  if (typeof criterion === 'string' && criterion.length > CRITERIA_MAX_LENGTH) return () => false;
  if (criterion === null) return numberCriterion('=', 0);
  if (typeof criterion === 'number') return numberCriterion('=', criterion);
  if (typeof criterion === 'boolean') return (value) => value === criterion;
  if (isError(criterion)) return (value) => isError(value) && value.error === criterion.error;
  const { op, operand, written } = splitOperator(criterion);
  if (operand === '') {
    if (!written) return (value) => value === null || value === '';
    if (op === '=') return (value) => value === null;
    if (op === '<>') return (value) => value !== null;
  }
  const number = operand.trim() === '' ? null : textToNumber(operand);
  if (number !== null) return numberCriterion(op, number);
  const upper = operand.toUpperCase();
  if ((upper === 'TRUE' || upper === 'FALSE') && (op === '=' || op === '<>')) {
    const want = upper === 'TRUE';
    return op === '=' ? (value) => value === want : (value) => value !== want;
  }
  const error = errorFromToken(operand);
  if (error !== null && (op === '=' || op === '<>')) {
    const same = (value: Scalar): boolean => isError(value) && value.error === error.error;
    return op === '=' ? same : (value) => !same(value);
  }
  return textCriterion(op, operand);
}

/** How many values meet the criterion. */
export function countIf(values: readonly Scalar[], criterion: Scalar): number {
  const test = parseCriterion(criterion);
  let count = 0;
  for (const value of values) if (test(value)) count++;
  return count;
}

/** For each value, whether it meets the criterion. */
export function matchMask(values: readonly Scalar[], criterion: Scalar): boolean[] {
  const test = parseCriterion(criterion);
  return values.map((value) => test(value));
}
