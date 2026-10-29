// Operators with Excel's coercion: empty is 0 or "" by context, text that is a canonical number is that number,
// and any other text in arithmetic is an error. Errors pass through unchanged.

import { err, finish, isError, toNumber, toText, type Value } from '../values';
import type { BinaryOp } from '../../../../core/expr';

function typeRank(v: Value): number {
  return typeof v === 'number' ? 1 : typeof v === 'string' ? 2 : 3;
}

/** The value an empty cell takes when compared with another value. */
function blankLike(other: Value): Value {
  return typeof other === 'string' ? '' : typeof other === 'boolean' ? false : 0;
}

/** Orders numbers before text before booleans. Text compares without regard to case. */
export function compareValues(a: Value, b: Value): number {
  if (a === null && b === null) return 0;
  const left = a === null ? blankLike(b) : a;
  const right = b === null ? blankLike(a) : b;
  if (typeRank(left) !== typeRank(right)) return typeRank(left) - typeRank(right);
  if (typeof left === 'number') return left - (right as number);
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

function arithmetic(op: BinaryOp, l: Value, r: Value): Value {
  const a = toNumber(l);
  const b = toNumber(r);
  if (typeof a !== 'number') return a;
  if (typeof b !== 'number') return b;
  switch (op) {
    case '+':
      return finish(a + b);
    case '-':
      return finish(a - b);
    case '*':
      return finish(a * b);
    case '/':
      return b === 0 ? err('DIV0') : finish(a / b);
    default:
      return a === 0 && b < 0 ? err('DIV0') : finish(a ** b);
  }
}

export function applyBinary(op: BinaryOp, l: Value, r: Value): Value {
  if (isError(l)) return l;
  if (isError(r)) return r;
  if (op === '&') {
    const [a, b] = [toText(l), toText(r)];
    return typeof a === 'string' && typeof b === 'string' ? a + b : err('VALUE');
  }
  return op === '+' || op === '-' || op === '*' || op === '/' || op === '^'
    ? arithmetic(op, l, r)
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
