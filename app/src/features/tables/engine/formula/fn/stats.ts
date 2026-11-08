// Statistical functions. Owner: tables:fn-stats. Written from the documented behavior of the spreadsheet functions:
// averages, spreads, ranks, percentiles, and pairs here; conditional counts in statsIfs.ts; the distributions and the
// regression functions in the lazy chunk (distributions.ts, regression.ts), declared at the end of this file.

import { gamma, lgamma } from '../../../../../core/num/special';
import { arrayOf, err, finish, isError, isNumber, toNumber, type Scalar, type Value } from '../../values';
import { numbersIn, type FnSpec2 } from './types';
import { functions as conditional } from './statsIfs';
import { declared } from './statsDeclared';
import {
  devsq,
  fixed,
  listOf,
  mean,
  numbersOf,
  numeric,
  overNumbers,
  pairsOf,
  readNumbers,
  sorted,
  sum,
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
  const top = Math.max(0, ...counts.values());
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

function kurt(nums: number[]): Value {
  const n = nums.length;
  const sd = stdev(nums, true);
  if (n < 4 || typeof sd !== 'number' || sd === 0) return err('DIV0');
  const m = mean(nums);
  const s4 = sum(nums.map((x) => ((x - m) / sd) ** 4));
  return finish((n * (n + 1) * s4) / ((n - 1) * (n - 2) * (n - 3)) - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3)));
}

function skew(nums: number[], sample: boolean): Value {
  const n = nums.length;
  const sd = stdev(nums, sample);
  if (n < (sample ? 3 : 1) || typeof sd !== 'number' || sd === 0) return err('DIV0');
  const m = mean(nums);
  const s3 = sum(nums.map((x) => ((x - m) / sd) ** 3));
  return finish(sample ? (n * s3) / ((n - 1) * (n - 2)) : s3 / n);
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

/** Cuts a fraction to `digits` decimal places toward zero, as the rank-percent functions do. */
function cut(x: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.floor(x * scale + 1e-9) / scale;
}

/** The share of values below x, from 0 to 1 (inclusive) or strictly between them (exclusive), interpolated. */
export function percentRankRun(exclusive: boolean): Run {
  return ([array, x, significance]) => {
    const nums = numbersOf(array);
    if (!Array.isArray(nums)) return nums;
    const read = readNumbers([x, significance ?? 3]);
    if (!Array.isArray(read)) return read;
    const [v, sig] = read;
    const digits = Math.trunc(sig);
    if (digits < 1 || nums.length === 0) return err(nums.length === 0 ? 'NA' : 'NUM');
    const s = sorted(nums);
    const n = s.length;
    if (v < s[0] || v > s[n - 1]) return err('NA');
    if (n === 1 && !exclusive) return 1;
    const below = (y: number) => s.filter((z) => z < y).length;
    const rank = (y: number) => (exclusive ? (below(y) + 1) / (n + 1) : below(y) / (n - 1));
    const hi = s.findIndex((z) => z >= v);
    if (s[hi] === v) return cut(rank(v), digits);
    const a = s[hi - 1];
    const b = s[hi];
    return cut(rank(a) + ((v - a) / (b - a)) * (rank(b) - rank(a)), digits);
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

function trimmean([array, percent]: Value[]): Value {
  const nums = numbersOf(array);
  const p = toNumber(percent);
  if (!Array.isArray(nums)) return nums;
  if (typeof p !== 'number') return p;
  if (p < 0 || p >= 1 || nums.length === 0) return err('NUM');
  const cutEach = Math.floor((nums.length * p) / 2);
  return finish(mean(sorted(nums).slice(cutEach, nums.length - cutEach)));
}

/** The statistics of two paired arrays: means, the sums of squares, and the cross products. */
function moments(xs: number[], ys: number[]) {
  const mx = mean(xs);
  const my = mean(ys);
  const sxx = sum(xs.map((x) => (x - mx) ** 2));
  const syy = sum(ys.map((y) => (y - my) ** 2));
  const sxy = sum(xs.map((x, i) => (x - mx) * (ys[i] - my)));
  return { n: xs.length, mx, my, sxx, syy, sxy };
}

/** A function of two paired arrays: CORREL(array1, array2), or SLOPE(known_y, known_x) with y first. */
function paired(name: string, f: (m: ReturnType<typeof moments>) => Value, example: string, yFirst = false): FnSpec2 {
  const list = yFirst ? 'knownY:a knownX:a' : 'array1:a array2:a';
  return fixed(
    S,
    name,
    list,
    ([a, b]) => {
      const p = yFirst ? pairsOf(b, a) : pairsOf(a, b);
      if (!('xs' in p)) return p;
      return p.xs.length === 0 ? err('DIV0') : f(moments(p.xs, p.ys));
    },
    example,
  );
}

const correl = (m: ReturnType<typeof moments>): Value =>
  m.sxx === 0 || m.syy === 0 ? err('DIV0') : finish(m.sxy / Math.sqrt(m.sxx * m.syy));

export const covariance = (sample: boolean) => (m: ReturnType<typeof moments>) =>
  sample && m.n < 2 ? err('DIV0') : finish(m.sxy / (sample ? m.n - 1 : m.n));

const slope = (m: ReturnType<typeof moments>): Value => (m.sxx === 0 ? err('DIV0') : finish(m.sxy / m.sxx));

function forecastLinear([x, ys, xs]: Value[]): Value {
  const at0 = toNumber(x);
  const p = pairsOf(xs, ys);
  if (typeof at0 !== 'number') return at0;
  if (!('xs' in p)) return p;
  if (p.xs.length === 0) return err('DIV0');
  const m = moments(p.xs, p.ys);
  return m.sxx === 0 ? err('DIV0') : finish(m.my + (m.sxy / m.sxx) * (at0 - m.mx));
}

/** FREQUENCY: how many values fall in each bin, plus one more for those above the last bin. A column. */
function frequency([data, bins]: Value[]): Value {
  const nums = numbersOf(data);
  const edges = numbersOf(bins);
  if (!Array.isArray(nums)) return nums;
  if (!Array.isArray(edges)) return edges;
  const counts = edges.map((edge, i) => {
    const below = Math.max(-Infinity, ...edges.filter((e, j) => e < edge || (e === edge && j < i)));
    const first = edges.indexOf(edge) === i;
    return first ? nums.filter((x) => x <= edge && x > below).length : 0;
  });
  const top = Math.max(-Infinity, ...edges);
  counts.push(nums.filter((x) => x > top).length);
  return arrayOf(counts.map((c) => [c]));
}

function prob([xr, pr, lower, upper]: Value[]): Value {
  const p = pairsOf(xr, pr);
  if (!('xs' in p)) return p;
  const read = readNumbers(upper === undefined ? [lower] : [lower, upper]);
  if (!Array.isArray(read)) return read;
  const [lo, hi = lo] = read;
  if (p.ys.some((q) => q < 0 || q > 1) || Math.abs(sum(p.ys) - 1) > 1e-9) return err('NUM');
  return finish(sum(p.xs.map((x, i) => (x >= lo && x <= hi ? p.ys[i] : 0))));
}

function permut([n, k]: number[]): number {
  const a = Math.trunc(n);
  const b = Math.trunc(k);
  if (a < 0 || b < 0 || a < b) return NaN;
  let p = 1;
  for (let i = 0; i < b; i++) p *= a - i;
  return p;
}

const positive = (f: (nums: number[]) => number) => (nums: number[]) =>
  nums.length === 0 || nums.some((x) => x <= 0) ? err('NUM') : finish(f(nums));

const core: FnSpec2[] = [
  overNumbers(S, 'AVERAGE', (n) => (n.length ? finish(mean(n)) : err('DIV0')), '=AVERAGE(2, 4, 9) gives 5'),
  overNumbers(S, 'MIN', (n) => (n.length ? Math.min(...n) : 0), '=MIN(4, -1, 7) gives -1'),
  overNumbers(S, 'MAX', (n) => (n.length ? Math.max(...n) : 0), '=MAX(4, -1, 7) gives 7'),
  listOf(S, 'COUNT', (args) => args.filter(isNumber).length, '=COUNT(1, 2, 3) gives 3'),
  listOf(
    S,
    'COUNTA',
    (args) => args.filter((v) => v !== null && v !== '').length,
    '=COUNTA("a", 1, TRUE) gives 3',
    true,
  ),
  overNumbers(S, 'MEDIAN', median, '=MEDIAN(5, 1, 3, 2) gives 2.5'),
  overNumbers(
    S,
    'AVEDEV',
    (n) => {
      if (n.length === 0) return err('NUM');
      const m = mean(n);
      return finish(mean(n.map((x) => Math.abs(x - m))));
    },
    '=AVEDEV(2, 4, 6) gives 1.33333333333333',
  ),
  overNumbers(S, 'DEVSQ', (n) => (n.length ? finish(devsq(n)) : err('NUM')), '=DEVSQ(1, 2, 3) gives 2'),
  overNumbers(
    S,
    'GEOMEAN',
    positive((n) => Math.exp(mean(n.map(Math.log)))),
    '=GEOMEAN(2, 8) gives 4',
  ),
  overNumbers(
    S,
    'HARMEAN',
    positive((n) => n.length / sum(n.map((x) => 1 / x))),
    '=HARMEAN(1, 4, 4) gives 2',
  ),
  overNumbers(S, 'KURT', kurt, '=KURT(1, 2, 3, 4, 10) gives 3.74096'),
  overNumbers(S, 'SKEW', (n) => skew(n, true), '=SKEW(1, 2, 10) gives 1.6523'),
  overNumbers(S, 'SKEW.P', (n) => skew(n, false), '=SKEW.P(1, 2, 10) gives 0.6745'),
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
  overA('MAXA', (n) => (n.length ? Math.max(...n) : 0), '=MAXA(-1, FALSE) gives 0'),
  overA('MINA', (n) => (n.length ? Math.min(...n) : 0), '=MINA(3, TRUE) gives 1'),
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
  fixed(
    S,
    'PERCENTRANK.INC',
    'array:a x [significance]',
    percentRankRun(false),
    '=PERCENTRANK.INC({1, 2, 3, 4, 5}, 2) gives 0.25',
  ),
  fixed(
    S,
    'PERCENTRANK.EXC',
    'array:a x [significance]',
    percentRankRun(true),
    '=PERCENTRANK.EXC({1, 2, 3, 4, 5}, 2) gives 0.333',
  ),
  fixed(S, 'RANK.EQ', 'number ref:a [order]', rankRun(false), '=RANK.EQ(3, {1, 3, 3, 5}) gives 2'),
  fixed(S, 'RANK.AVG', 'number ref:a [order]', rankRun(true), '=RANK.AVG(3, {1, 3, 3, 5}) gives 2.5'),
  fixed(S, 'TRIMMEAN', 'array:a percent', trimmean, '=TRIMMEAN({1, 2, 3, 4, 100}, 0.4) gives 3'),
  paired('CORREL', correl, '=CORREL({1, 2, 3}, {2, 4, 7}) gives 0.99339926'),
  paired('PEARSON', correl, '=PEARSON({1, 2, 3}, {2, 4, 7}) gives 0.99339926'),
  paired(
    'RSQ',
    (m) => {
      const r = correl(m);
      return typeof r === 'number' ? r * r : r;
    },
    '=RSQ({2, 4, 7}, {1, 2, 3}) gives 0.98684211',
    true,
  ),
  paired('COVARIANCE.P', covariance(false), '=COVARIANCE.P({1, 2, 3}, {1, 2, 3}) gives 0.666666666666667'),
  paired('COVARIANCE.S', covariance(true), '=COVARIANCE.S({1, 2, 3}, {1, 2, 3}) gives 1'),
  paired('SLOPE', slope, '=SLOPE({2, 4, 6}, {1, 2, 3}) gives 2', true),
  paired(
    'INTERCEPT',
    (m) => {
      const b = slope(m);
      return typeof b === 'number' ? finish(m.my - b * m.mx) : b;
    },
    '=INTERCEPT({3, 5, 7}, {1, 2, 3}) gives 1',
    true,
  ),
  paired(
    'STEYX',
    (m) => {
      if (m.n < 3) return err('DIV0');
      if (m.sxx === 0) return err('DIV0');
      return finish(Math.sqrt(Math.max(0, m.syy - (m.sxy * m.sxy) / m.sxx) / (m.n - 2)));
    },
    '=STEYX({1, 3, 2}, {1, 2, 3}) gives 0.707106781186548',
    true,
  ),
  fixed(S, 'FORECAST', 'x knownY:a knownX:a', forecastLinear, '=FORECAST(4, {2, 4, 6}, {1, 2, 3}) gives 8'),
  fixed(
    S,
    'FORECAST.LINEAR',
    'x knownY:a knownX:a',
    forecastLinear,
    '=FORECAST.LINEAR(4, {2, 4, 6}, {1, 2, 3}) gives 8',
  ),
  fixed(S, 'FREQUENCY', 'data:a bins:a', frequency, '=FREQUENCY({1, 2, 5}, {2}) gives 2 and 1 in a column'),
  fixed(S, 'PROB', 'xRange:a probRange:a lower [upper]', prob, '=PROB({1, 2, 3}, {0.2, 0.3, 0.5}, 2, 3) gives 0.8'),
  fixed(
    S,
    'STANDARDIZE',
    'x mean sd',
    numeric(([x, m, sd]) => (sd <= 0 ? NaN : (x - m) / sd)),
    '=STANDARDIZE(7, 5, 2) gives 1',
  ),
  fixed(
    S,
    'FISHER',
    'x',
    numeric(([x]) => (Math.abs(x) >= 1 ? NaN : Math.atanh(x))),
    '=FISHER(0.5) gives 0.549306144',
  ),
  fixed(
    S,
    'FISHERINV',
    'y',
    numeric(([y]) => Math.tanh(y)),
    '=FISHERINV(0.549306144) gives 0.5',
  ),
  fixed(S, 'PERMUT', 'number chosen', numeric(permut), '=PERMUT(5, 2) gives 20'),
  fixed(
    S,
    'PERMUTATIONA',
    'number chosen',
    numeric(([n, k]) => {
      const a = Math.trunc(n);
      const b = Math.trunc(k);
      return a < 0 || b < 0 ? NaN : a ** b;
    }),
    '=PERMUTATIONA(3, 2) gives 9',
  ),
  fixed(
    S,
    'GAMMA',
    'x',
    numeric(([x]) => gamma(x)),
    '=GAMMA(5) gives 24',
  ),
  fixed(
    S,
    'GAMMALN',
    'x',
    numeric(([x]) => (x <= 0 ? NaN : lgamma(x))),
    '=GAMMALN(4) gives 1.79175946922805',
  ),
  fixed(
    S,
    'GAMMALN.PRECISE',
    'x',
    numeric(([x]) => (x <= 0 ? NaN : lgamma(x))),
    '=GAMMALN.PRECISE(4) gives 1.79175946922805',
  ),
];

export const stdevOf = stdev;
export { numbersIn };

export const functions: readonly FnSpec2[] = [...core, ...conditional, ...declared];
