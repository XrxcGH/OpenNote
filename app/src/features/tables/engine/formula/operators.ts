// Operators with Excel's coercion (ADR 0058): empty is 0 or "" by context, text that reads as a number (currency,
// percent, a fraction, a time, a date) is that number, and any other text in arithmetic is an error. Errors pass
// through unchanged. Numbers compare on their 15-digit form, so 0.1+0.2=0.3 is TRUE.

import {
  err,
  finish,
  isError,
  nearZero,
  round15,
  toNumber,
  toScalar,
  toText,
  type Scalar,
  type Value,
} from '../values';
import type { BinaryOp } from '../../../../core/expr';

function typeRank(v: Scalar): number {
  return typeof v === 'number' ? 1 : typeof v === 'string' ? 2 : 3;
}

/** The value an empty cell takes when compared with another value. */
function blankLike(other: Scalar): Scalar {
  return typeof other === 'string' ? '' : typeof other === 'boolean' ? false : 0;
}

/** Orders numbers before text before booleans. Text compares without regard to case. */
export function compareValues(first: Value, second: Value): number {
  const [a, b] = [toScalar(first), toScalar(second)];
  if (a === null && b === null) return 0;
  const left = a === null ? blankLike(b) : a;
  const right = b === null ? blankLike(a) : b;
  if (typeRank(left) !== typeRank(right)) return typeRank(left) - typeRank(right);
  if (typeof left === 'number') return round15(left) - round15(right as number);
  if (typeof left === 'string') {
    const [x, y] = [left.toLowerCase(), (right as string).toLowerCase()];
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return Number(left) - Number(right as boolean);
}

function compareOp(op: BinaryOp, l: Value, r: Value): boolean {
  const order = compareValues(l, r);
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
    default:
      return order >= 0;
  }
}

function arithmetic(op: BinaryOp, l: Value, r: Value, final: boolean): Value {
  const a = toNumber(l);
  const b = toNumber(r);
  if (typeof a !== 'number') return a;
  if (typeof b !== 'number') return b;
  switch (op) {
    case '+':
      return finish(final ? nearZero(a, b) : a + b);
    case '-':
      return finish(final ? nearZero(a, -b) : a - b);
    case '*':
      return finish(a * b);
    case '/':
      return b === 0 ? err('DIV0') : finish(a / b);
    default:
      // Excel calls zero to the power of zero undefined, for the operator as for POWER.
      if (a === 0 && b === 0) return err('NUM');
      return a === 0 && b < 0 ? err('DIV0') : finish(a ** b);
  }
}

/**
 * Applies an operator. `final` marks the formula's last operation, where an addition or subtraction within
 * rounding error of zero gives 0 (nearZero).
 */
export function applyBinary(op: BinaryOp, left: Value, right: Value, final = false): Value {
  const [l, r] = [toScalar(left), toScalar(right)];
  if (isError(l)) return l;
  if (isError(r)) return r;
  if (op === '&') {
    const [a, b] = [toText(l), toText(r)];
    return typeof a === 'string' && typeof b === 'string' ? a + b : err('VALUE');
  }
  return op === '+' || op === '-' || op === '*' || op === '/' || op === '^'
    ? arithmetic(op, l, r, final)
    : compareOp(op, l, r);
}

export function applyPercent(v: Value): Value {
  const n = toNumber(v);
  return typeof n === 'number' ? finish(n / 100) : n;
}

export function applyNegate(v: Value): Value {
  const n = toNumber(v);
  return typeof n === 'number' ? (n === 0 ? 0 : -n) : n;
}

export function applySqrt(v: Value): Value {
  const n = toNumber(v);
  if (typeof n !== 'number') return n;
  return n < 0 ? err('NUM') : finish(Math.sqrt(n));
}
