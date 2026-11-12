// Shared parts of the lookup functions (fn/lookup.ts): how a lookup value matches an item, Excel's binary search
// for sorted data, and reading whole-number arguments. Written from Microsoft's documented rules (ADR 0058).

import { isArray, round15, toNumber, type ArrayValue, type FormulaError, type Scalar, type Value } from '../../values';
import { asArray } from '../../arrays';
import { hasWildcard, wildcardMatcher } from './criteria';

/** The kind order sorted data follows: numbers, then text, then booleans. Empty cells and errors have none. */
export function rankOf(v: Scalar): number {
  if (typeof v === 'number') return 0;
  if (typeof v === 'string') return 1;
  if (typeof v === 'boolean') return 2;
  return -1;
}

/** Orders two values of one kind. Text compares without regard to case; numbers compare to 15 digits. */
export function order(a: Scalar, b: Scalar): number {
  if (typeof a === 'number' && typeof b === 'number') return round15(a) - round15(b);
  if (typeof a === 'string' && typeof b === 'string') {
    const [x, y] = [a.toLowerCase(), b.toLowerCase()];
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return Number(a) - Number(b);
}

/**
 * A test for exact matches. Text matches without regard to case. With `wildcards`, text with * or ? matches as a
 * pattern and ~ escapes them, so "a~*" matches the text a*. An empty lookup value matches empty items only when
 * `blank` is set, as XLOOKUP does.
 */
export function exactTest(x: Scalar, wildcards: boolean, blank = false): (item: Scalar) => boolean {
  if (x === null) return blank ? (item) => item === null : () => false;
  if (typeof x === 'string') {
    if (wildcards && (hasWildcard(x) || x.includes('~'))) {
      const test = wildcardMatcher(x);
      return (item) => typeof item === 'string' && test(item);
    }
    const want = x.toLowerCase();
    return (item) => typeof item === 'string' && item.toLowerCase() === want;
  }
  if (typeof x === 'number') {
    const want = round15(x);
    return (item) => typeof item === 'number' && round15(item) === want;
  }
  return (item) => item === x;
}

/** The first index, in the order given, whose item passes the test. -1 when none does. */
export function firstWhere(items: readonly Scalar[], test: (item: Scalar) => boolean, backward = false): number {
  if (backward) {
    for (let i = items.length - 1; i >= 0; i--) if (test(items[i])) return i;
  } else {
    for (let i = 0; i < items.length; i++) if (test(items[i])) return i;
  }
  return -1;
}

/**
 * Excel's binary search over data meant to be sorted. It halves [lo, hi] at the middle item, rounded down. An item
 * of another kind (or empty) is passed over for the nearest one of the lookup value's kind, looking down first. When
 * `fits` holds for the item, it is the best so far, and the search goes on toward the end when `towardEnd` is set
 * and toward the start otherwise. On data that is not sorted the answer is the one this rule gives, as in Excel.
 */
export function binarySearch(
  items: readonly Scalar[],
  x: Scalar,
  fits: (order: number) => boolean,
  towardEnd: boolean,
): number {
  const rank = rankOf(x);
  if (rank < 0) return -1;
  let lo = 0;
  let hi = items.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    let m = mid;
    while (m >= lo && rankOf(items[m]) !== rank) m--;
    if (m < lo) {
      m = mid + 1;
      while (m <= hi && rankOf(items[m]) !== rank) m++;
      if (m > hi) break;
    }
    const good = fits(order(items[m], x));
    if (good) best = m;
    if (good === towardEnd) lo = m + 1;
    else hi = m - 1;
  }
  return best;
}

/** The last item at most `x` in ascending data, or the last item at least `x` in descending data. */
export function approximate(items: readonly Scalar[], x: Scalar, descending = false): number {
  return binarySearch(items, x, descending ? (c) => c >= 0 : (c) => c <= 0, true);
}

/** The items of a single row or column, or null for a block with both more rows and more columns. */
export function vectorOf(value: Value): Scalar[] | null {
  const a = asArray(value);
  if (a.rows !== 1 && a.cols !== 1) return null;
  return [...a.data];
}

/** Row `r` of an array as a one-row array. */
export function rowOf(a: ArrayValue, r: number): ArrayValue {
  return { kind: 'array', rows: 1, cols: a.cols, data: a.data.slice(r * a.cols, (r + 1) * a.cols) };
}

/** Column `c` of an array as a one-column array. */
export function columnOf(a: ArrayValue, c: number): ArrayValue {
  const data: Scalar[] = [];
  for (let r = 0; r < a.rows; r++) data.push(a.data[r * a.cols + c]);
  return { kind: 'array', rows: a.rows, cols: 1, data };
}

/** The array with rows and columns swapped. */
export function transpose(a: ArrayValue): ArrayValue {
  const data: Scalar[] = [];
  for (let c = 0; c < a.cols; c++) for (let r = 0; r < a.rows; r++) data.push(a.data[r * a.cols + c]);
  return { kind: 'array', rows: a.cols, cols: a.rows, data };
}

/** A whole number from an argument, cut toward zero. An omitted or empty argument gives `fallback`. */
export function wholeArg(v: Value | undefined, fallback: number): number | FormulaError {
  if (v === undefined || v === null) return fallback;
  const n = toNumber(v);
  return typeof n === 'number' ? Math.trunc(n) : n;
}

/** A one-by-one array stands for its value, as one cell does. */
export function unwrap(v: Value): Value {
  return isArray(v) && v.rows === 1 && v.cols === 1 ? v.data[0] : v;
}
