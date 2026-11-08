// The compatibility names of the statistical functions: the older spellings spreadsheets still accept, such as STDEV
// for STDEV.S and NORMDIST for NORM.DIST. Owner: tables:fn-stats. Each gives what its modern form gives for the same
// arguments. The ones about distributions run from the lazy chunk (distributions.ts); the rest run here.

import type { FnSpec2 } from './types';
import { err, finish, toNumber, type Value } from '../../values';
import { modeSngl, percentile, percentRankRun, quartileRun, rankRun, stdevOf, variance } from './stats';
import { fixed, lazy, numbersOf, overNumbers, pairsOf } from './statsKit';

const C = 'statsCompat' as const;

const LAZY: readonly [string, string, string][] = [
  ['BETADIST', 'x alpha beta [lower] [upper]', '=BETADIST(0.5, 2, 2) gives 0.5'],
  ['BETAINV', 'probability alpha beta [lower] [upper]', '=BETAINV(0.5, 2, 2) gives 0.5'],
  ['BINOMDIST', 'successes trials probability cumulative:b', '=BINOMDIST(1, 2, 0.5, FALSE) gives 0.5'],
  ['CHIDIST', 'x degrees', '=CHIDIST(0, 2) gives 1'],
  ['CHIINV', 'probability degrees', '=CHIINV(1, 2) gives 0'],
  ['CHITEST', 'actual:a expected:a', '=CHITEST({10, 10}, {10, 10}) gives 1'],
  ['CONFIDENCE', 'alpha sd size', '=CONFIDENCE(0.05, 1, 1) gives 1.95996398454005'],
  ['CRITBINOM', 'trials probability alpha', '=CRITBINOM(2, 0.5, 0.5) gives 1'],
  ['EXPONDIST', 'x lambda cumulative:b', '=EXPONDIST(0, 2, FALSE) gives 2'],
  ['FDIST', 'x degrees1 degrees2', '=FDIST(1, 2, 2) gives 0.5'],
  ['FINV', 'probability degrees1 degrees2', '=FINV(0.5, 2, 2) gives 1'],
  ['FTEST', 'array1:a array2:a', '=FTEST({1, 2, 3}, {2, 3, 4}) gives 1'],
  ['GAMMADIST', 'x alpha beta cumulative:b', '=GAMMADIST(0, 1, 1, FALSE) gives 1'],
  ['GAMMAINV', 'probability alpha beta', '=GAMMAINV(0, 1, 1) gives 0'],
  ['HYPGEOMDIST', 'sampleS sample populationS population', '=HYPGEOMDIST(1, 1, 1, 2) gives 0.5'],
  ['LOGINV', 'probability mean sd', '=LOGINV(0.5, 0, 1) gives 1'],
  ['LOGNORMDIST', 'x mean sd', '=LOGNORMDIST(1, 0, 1) gives 0.5'],
  ['NEGBINOMDIST', 'failures successes probability', '=NEGBINOMDIST(0, 1, 0.5) gives 0.5'],
  ['NORMDIST', 'x mean sd cumulative:b', '=NORMDIST(5, 5, 2, TRUE) gives 0.5'],
  ['NORMINV', 'probability mean sd', '=NORMINV(0.5, 5, 2) gives 5'],
  ['NORMSDIST', 'z', '=NORMSDIST(0) gives 0.5'],
  ['NORMSINV', 'probability', '=NORMSINV(0.5) gives 0'],
  ['POISSON', 'x mean cumulative:b', '=POISSON(0, 1, FALSE) gives 0.367879441171442'],
  ['TDIST', 'x degrees tails', '=TDIST(0, 3, 2) gives 1'],
  ['TINV', 'probability degrees', '=TINV(1, 3) gives 0'],
  ['TTEST', 'array1:a array2:a tails type', '=TTEST({1, 2, 3}, {1, 2, 3}, 2, 2) gives 1'],
  ['WEIBULL', 'x alpha beta cumulative:b', '=WEIBULL(0, 1, 1, TRUE) gives 0'],
  ['ZTEST', 'array:a x [sigma]', '=ZTEST({4, 6}, 5) gives 0.5'],
];

function percentileInc([array, k]: Value[]): Value {
  const nums = numbersOf(array);
  const p = toNumber(k);
  if (!Array.isArray(nums)) return nums;
  return typeof p === 'number' ? percentile(nums, p, false) : p;
}

function covar([a, b]: Value[]): Value {
  const p = pairsOf(a, b);
  if (!('xs' in p)) return p;
  const n = p.xs.length;
  if (n === 0) return err('DIV0');
  const mx = p.xs.reduce((s, x) => s + x, 0) / n;
  const my = p.ys.reduce((s, y) => s + y, 0) / n;
  const sxy = p.xs.reduce((s, x, i) => s + (x - mx) * (p.ys[i] - my), 0);
  return finish(sxy / n);
}

const here: FnSpec2[] = [
  fixed(C, 'COVAR', 'array1:a array2:a', covar, '=COVAR({1, 2, 3}, {1, 2, 3}) gives 0.666666666666667'),
  overNumbers(C, 'MODE', modeSngl, '=MODE(1, 2, 2, 3) gives 2'),
  fixed(C, 'PERCENTILE', 'array:a k', percentileInc, '=PERCENTILE({1, 2, 3, 4}, 0.3) gives 1.9'),
  fixed(
    C,
    'PERCENTRANK',
    'array:a x [significance]',
    percentRankRun(false),
    '=PERCENTRANK({1, 2, 3, 4, 5}, 2) gives 0.25',
  ),
  fixed(C, 'QUARTILE', 'array:a quart', quartileRun(false), '=QUARTILE({1, 2, 3, 4}, 1) gives 1.75'),
  fixed(C, 'RANK', 'number ref:a [order]', rankRun(false), '=RANK(3, {1, 3, 3, 5}) gives 2'),
  overNumbers(C, 'STDEV', (n) => stdevOf(n, true), '=STDEV(2, 4, 4, 4, 5, 5, 7, 9) gives 2.138'),
  overNumbers(C, 'STDEVP', (n) => stdevOf(n, false), '=STDEVP(2, 4, 4, 4, 5, 5, 7, 9) gives 2'),
  overNumbers(C, 'VAR', (n) => variance(n, true), '=VAR(1, 2, 3, 4) gives 1.66666666666667'),
  overNumbers(C, 'VARP', (n) => variance(n, false), '=VARP(1, 2, 3, 4) gives 1.25'),
];

export const functions: readonly FnSpec2[] = [
  ...here,
  ...LAZY.map(([name, list, example]) => lazy(C, name, list, example)),
];
