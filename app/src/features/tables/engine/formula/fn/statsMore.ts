// The statistical functions past the basics: shape, percent ranks, pairs, and the small transforms. Owner:
// tables:fn-stats. Lazy chunk only: statsDeclared.ts declares them, and these are the runs by name.

import { gamma, lgamma } from '../../../../../core/num/special';
import { arrayOf, err, finish, toNumber, type Value } from '../../values';
import { numbersIn } from './types';
import { devsq, mean, numbersOf, numeric, pairsOf, readNumbers, sorted, sum, type Run } from './statsKit';

const stdev = (nums: number[], sample: boolean): number => Math.sqrt(devsq(nums) / (nums.length - (sample ? 1 : 0)));

/** A run over the numbers of a list of values. */
const overNumbers =
  (f: (nums: number[]) => Value): Run =>
  (args) => {
    const nums = numbersIn(args);
    return Array.isArray(nums) ? f(nums) : nums;
  };

function kurt(nums: number[]): Value {
  const n = nums.length;
  if (n < 4) return err('DIV0');
  const sd = stdev(nums, true);
  if (sd === 0) return err('DIV0');
  const m = mean(nums);
  const s4 = sum(nums.map((x) => ((x - m) / sd) ** 4));
  return finish((n * (n + 1) * s4) / ((n - 1) * (n - 2) * (n - 3)) - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3)));
}

function skew(nums: number[], sample: boolean): Value {
  const n = nums.length;
  if (n < (sample ? 3 : 1)) return err('DIV0');
  const sd = stdev(nums, sample);
  if (sd === 0) return err('DIV0');
  const m = mean(nums);
  const s3 = sum(nums.map((x) => ((x - m) / sd) ** 3));
  return finish(sample ? (n * s3) / ((n - 1) * (n - 2)) : s3 / n);
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

function trimmean([array, percent]: Value[]): Value {
  const nums = numbersOf(array);
  const p = toNumber(percent);
  if (!Array.isArray(nums)) return nums;
  if (typeof p !== 'number') return p;
  if (p < 0 || p >= 1 || nums.length === 0) return err('NUM');
  const cutEach = Math.floor((nums.length * p) / 2);
  return finish(mean(sorted(nums).slice(cutEach, nums.length - cutEach)));
}

interface Moments {
  readonly n: number;
  readonly mx: number;
  readonly my: number;
  readonly sxx: number;
  readonly syy: number;
  readonly sxy: number;
}

/** The statistics of two paired arrays: means, the sums of squares, and the cross products. */
function moments(xs: number[], ys: number[]): Moments {
  const mx = mean(xs);
  const my = mean(ys);
  const sxx = sum(xs.map((x) => (x - mx) ** 2));
  const syy = sum(ys.map((y) => (y - my) ** 2));
  const sxy = sum(xs.map((x, i) => (x - mx) * (ys[i] - my)));
  return { n: xs.length, mx, my, sxx, syy, sxy };
}

/** A function of two paired arrays: CORREL(array1, array2), or SLOPE(known_y, known_x) with y first. */
function paired(f: (m: Moments) => Value, yFirst = false): Run {
  return ([a, b]) => {
    const p = yFirst ? pairsOf(b, a) : pairsOf(a, b);
    if (!('xs' in p)) return p;
    return p.xs.length === 0 ? err('DIV0') : f(moments(p.xs, p.ys));
  };
}

const correl = (m: Moments): Value =>
  m.sxx === 0 || m.syy === 0 ? err('DIV0') : finish(m.sxy / Math.sqrt(m.sxx * m.syy));
const covariance = (sample: boolean) => (m: Moments) =>
  sample && m.n < 2 ? err('DIV0') : finish(m.sxy / (sample ? m.n - 1 : m.n));
const slope = (m: Moments): Value => (m.sxx === 0 ? err('DIV0') : finish(m.sxy / m.sxx));

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

const lnGamma = numeric(([x]) => (x <= 0 ? NaN : lgamma(x)));

/** The covariance of COVAR, the population form. */
const covar = paired(covariance(false));

export const runs: Readonly<Record<string, Run>> = {
  AVEDEV: overNumbers((n) => {
    if (n.length === 0) return err('NUM');
    const m = mean(n);
    return finish(mean(n.map((x) => Math.abs(x - m))));
  }),
  DEVSQ: overNumbers((n) => (n.length ? finish(devsq(n)) : err('NUM'))),
  GEOMEAN: overNumbers(positive((n) => Math.exp(mean(n.map(Math.log))))),
  HARMEAN: overNumbers(positive((n) => n.length / sum(n.map((x) => 1 / x)))),
  KURT: overNumbers(kurt),
  SKEW: overNumbers((n) => skew(n, true)),
  'SKEW.P': overNumbers((n) => skew(n, false)),
  'PERCENTRANK.INC': percentRankRun(false),
  'PERCENTRANK.EXC': percentRankRun(true),
  TRIMMEAN: trimmean,
  CORREL: paired(correl),
  PEARSON: paired(correl),
  RSQ: paired((m) => {
    const r = correl(m);
    return typeof r === 'number' ? r * r : r;
  }, true),
  'COVARIANCE.P': paired(covariance(false)),
  'COVARIANCE.S': paired(covariance(true)),
  SLOPE: paired(slope, true),
  INTERCEPT: paired((m) => {
    const b = slope(m);
    return typeof b === 'number' ? finish(m.my - b * m.mx) : b;
  }, true),
  STEYX: paired((m) => {
    if (m.n < 3 || m.sxx === 0) return err('DIV0');
    return finish(Math.sqrt(Math.max(0, m.syy - (m.sxy * m.sxy) / m.sxx) / (m.n - 2)));
  }, true),
  FORECAST: forecastLinear,
  'FORECAST.LINEAR': forecastLinear,
  FREQUENCY: frequency,
  PROB: prob,
  STANDARDIZE: numeric(([x, m, sd]) => (sd <= 0 ? NaN : (x - m) / sd)),
  FISHER: numeric(([x]) => (Math.abs(x) >= 1 ? NaN : Math.atanh(x))),
  FISHERINV: numeric(([y]) => Math.tanh(y)),
  PERMUT: numeric(permut),
  PERMUTATIONA: numeric(([n, k]) => {
    const a = Math.trunc(n);
    const b = Math.trunc(k);
    return a < 0 || b < 0 ? NaN : a ** b;
  }),
  GAMMA: numeric(([x]) => gamma(x)),
  GAMMALN: lnGamma,
  'GAMMALN.PRECISE': lnGamma,
  // Compatibility names.
  COVAR: covar,
  PERCENTRANK: percentRankRun(false),
};
