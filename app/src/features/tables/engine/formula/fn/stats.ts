// Statistical functions. Owner: tables:fn-stats. Written from the documented behavior of the spreadsheet functions.
// The basics are here: averages, spreads, modes, order, percentiles, and ranks. Conditional counts are in statsIfs.ts.
// The rest is in the lazy chunk (statsMore.ts, distributions.ts, regression.ts), declared in statsDeclared.ts.

import { arrayOf, err, finish, isError, isNumber, toNumber, type Scalar, type Value } from '../../values';
import { numbersIn, type FnSpec2 } from './types';
import { functions as conditional } from './statsIfs';
import { declared } from './statsDeclared';
import {
  devsq,
  fixed,
  largest,
  listOf,
  mean,
  numbersOf,
  overNumbers,
  readNumbers,
  smallest,
  sorted,
  type Run,
} from './statsKit';

const S = 'stats' as const;

export function median(nums: number[]): Value {
  if (nums.length === 0) return err('NUM');
  const s = sorted(nums);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : finish((s[mid - 1] + s[mid]) / 2);
}

/** Sample (n - 1) or population (n) variance. */
export function variance(nums: number[], sample: boolean): Value {
  const d = sample ? nums.length - 1 : nums.length;
  return d <= 0 ? err('DIV0') : finish(devsq(nums) / d);
}

const stdev = (nums: number[], sample: boolean): Value => {
  const v = variance(nums, sample);
  return typeof v === 'number' ? Math.sqrt(v) : v;
};

/** The modes in order of first appearance; empty when no value repeats. */
function modes(nums: number[]): number[] {
  const counts = new Map<number, number>();
  for (const x of nums) counts.set(x, (counts.get(x) ?? 0) + 1);
  const top = Math.max(0, largest(counts.values()));
  if (top < 2) return [];
  return [...counts.entries()].filter(([, c]) => c === top).map(([x]) => x);
}

export const modeSngl = (nums: number[]): Value => modes(nums)[0] ?? err('NA');

/** The A functions read text in a list as 0 and TRUE as 1. Empty cells are skipped. Typed text that is a number counts. */
function valuesA(args: readonly Value[]): number[] | Scalar {
  const out: number[] = [];
  for (const v of args) {
    if (isError(v)) return v;
    if (typeof v === 'number') out.push(v);
    else if (typeof v === 'boolean') out.push(v ? 1 : 0);
    else if (typeof v === 'string' && v !== '') out.push(0);
  }
  return out;
}

function overA(name: string, f: (nums: number[]) => Value, example: string): FnSpec2 {
  return listOf(
    S,
    name,
    (args) => {
      const nums = valuesA(args);
      return Array.isArray(nums) ? f(nums) : nums;
    },
    example,
    true,
  );
}

/** The k-th value counted from the bottom (ascending) or the top. */
function kth(ascending: boolean): Run {
  return ([array, k]) => {
    const nums = numbersOf(array);
    const pos = toNumber(k);
    if (!Array.isArray(nums)) return nums;
    if (typeof pos !== 'number') return pos;
    const i = Math.ceil(pos);
    if (i < 1 || i > nums.length) return err('NUM');
    const s = sorted(nums);
    return ascending ? s[i - 1] : s[s.length - i];
  };
}

/** The value at a zero-based fractional position in sorted numbers, by straight-line interpolation. */
function at(s: number[], pos: number): number {
  const lo = Math.floor(pos);
  const frac = pos - lo;
  return frac === 0 ? s[lo] : s[lo] + frac * (s[lo + 1] - s[lo]);
}

export function percentile(nums: number[], k: number, exclusive: boolean): Value {
  const n = nums.length;
  if (n === 0) return err('NUM');
  if (!exclusive) return k < 0 || k > 1 ? err('NUM') : at(sorted(nums), k * (n - 1));
  const rank = k * (n + 1);
  if (k <= 0 || k >= 1 || rank < 1 || rank > n) return err('NUM');
  return at(sorted(nums), rank - 1);
}

function percentileRun(exclusive: boolean): Run {
  return ([array, k]) => {
    const nums = numbersOf(array);
    const p = toNumber(k);
    if (!Array.isArray(nums)) return nums;
    return typeof p === 'number' ? percentile(nums, p, exclusive) : p;
  };
}

export function quartileRun(exclusive: boolean): Run {
  return ([array, q]) => {
    const nums = numbersOf(array);
    const quart = toNumber(q);
    if (!Array.isArray(nums)) return nums;
    if (typeof quart !== 'number') return quart;
    const k = Math.trunc(quart);
    if (exclusive ? k < 1 || k > 3 : k < 0 || k > 4) return err('NUM');
    return percentile(nums, k / 4, exclusive);
  };
}

export function rankRun(average: boolean): Run {
  return ([value, ref, order]) => {
    const nums = numbersOf(ref);
    const read = readNumbers([value, order ?? 0]);
    if (!Array.isArray(nums)) return nums;
    if (!Array.isArray(read)) return read;
    const [v, ord] = read;
    const equal = nums.filter((x) => x === v).length;
    if (equal === 0) return err('NA');
    const before = nums.filter((x) => (ord === 0 ? x > v : x < v)).length;
    return average ? before + 1 + (equal - 1) / 2 : before + 1;
  };
}

const core: FnSpec2[] = [
  overNumbers(S, 'AVERAGE', (n) => (n.length ? finish(mean(n)) : err('DIV0')), '=AVERAGE(2, 4, 9) gives 5'),
  overNumbers(S, 'MIN', (n) => (n.length ? smallest(n) : 0), '=MIN(4, -1, 7) gives -1'),
  overNumbers(S, 'MAX', (n) => (n.length ? largest(n) : 0), '=MAX(4, -1, 7) gives 7'),
  listOf(S, 'COUNT', (args) => args.filter(isNumber).length, '=COUNT(1, 2, 3) gives 3'),
  listOf(
    S,
    'COUNTA',
    (args) => args.filter((v) => v !== null && v !== '').length,
    '=COUNTA("a", 1, TRUE) gives 3',
    true,
  ),
  overNumbers(S, 'MEDIAN', median, '=MEDIAN(5, 1, 3, 2) gives 2.5'),
  overNumbers(S, 'STDEV.S', (n) => stdev(n, true), '=STDEV.S(2, 4, 4, 4, 5, 5, 7, 9) gives 2.138'),
  overNumbers(S, 'STDEV.P', (n) => stdev(n, false), '=STDEV.P(2, 4, 4, 4, 5, 5, 7, 9) gives 2'),
  overNumbers(S, 'VAR.S', (n) => variance(n, true), '=VAR.S(1, 2, 3, 4) gives 1.66666666666667'),
  overNumbers(S, 'VAR.P', (n) => variance(n, false), '=VAR.P(1, 2, 3, 4) gives 1.25'),
  overNumbers(S, 'MODE.SNGL', modeSngl, '=MODE.SNGL(1, 2, 2, 3) gives 2'),
  overNumbers(
    S,
    'MODE.MULT',
    (n) => {
      const found = modes(n);
      return found.length ? arrayOf(found.map((x) => [x])) : err('NA');
    },
    '=MODE.MULT(1, 1, 2, 2, 3) gives 1 and 2 in a column',
  ),
  overA('AVERAGEA', (n) => (n.length ? finish(mean(n)) : err('DIV0')), '=AVERAGEA(2, TRUE) gives 1.5'),
  overA('MAXA', (n) => (n.length ? largest(n) : 0), '=MAXA(-1, FALSE) gives 0'),
  overA('MINA', (n) => (n.length ? smallest(n) : 0), '=MINA(3, TRUE) gives 1'),
  overA('STDEVA', (n) => stdev(n, true), '=STDEVA(1, TRUE, 4) gives 1.73205080756888'),
  overA('STDEVPA', (n) => stdev(n, false), '=STDEVPA(0, 2) gives 1'),
  overA('VARA', (n) => variance(n, true), '=VARA(1, TRUE, 4) gives 3'),
  overA('VARPA', (n) => variance(n, false), '=VARPA(0, 2) gives 1'),
  fixed(S, 'LARGE', 'array:a k', kth(false), '=LARGE({3, 9, 4}, 2) gives 4'),
  fixed(S, 'SMALL', 'array:a k', kth(true), '=SMALL({3, 9, 4}, 2) gives 4'),
  fixed(S, 'PERCENTILE.INC', 'array:a k', percentileRun(false), '=PERCENTILE.INC({1, 2, 3, 4}, 0.3) gives 1.9'),
  fixed(S, 'PERCENTILE.EXC', 'array:a k', percentileRun(true), '=PERCENTILE.EXC({1, 2, 3, 4}, 0.4) gives 2'),
  fixed(S, 'QUARTILE.INC', 'array:a quart', quartileRun(false), '=QUARTILE.INC({1, 2, 3, 4}, 1) gives 1.75'),
  fixed(S, 'QUARTILE.EXC', 'array:a quart', quartileRun(true), '=QUARTILE.EXC({1, 2, 3, 4, 5, 6, 7}, 1) gives 2'),
  fixed(S, 'RANK.EQ', 'number ref:a [order]', rankRun(false), '=RANK.EQ(3, {1, 3, 3, 5}) gives 2'),
  fixed(S, 'RANK.AVG', 'number ref:a [order]', rankRun(true), '=RANK.AVG(3, {1, 3, 3, 5}) gives 2.5'),
];

export const stdevOf = stdev;
export { numbersIn };

export const functions: readonly FnSpec2[] = [...core, ...conditional, ...declared];
