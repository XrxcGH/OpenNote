// The statistical functions whose code is in the lazy chunk: the distributions, the tests, and the regression and
// forecasting functions. Owner: tables:fn-stats. Each is declared here with its parameters, so formulas compile and
// autocomplete lists it before the chunk loads; statsKit.ts runs it once the chunk is in.

import type { FnSpec2 } from './types';
import { lazy } from './statsKit';

const S = 'stats' as const;

/** Name, parameter list (statsKit.ts paramsFrom), and an example of our own. */
const TABLE: readonly [string, string, string][] = [
  ['BETA.DIST', 'x alpha beta cumulative:b [lower] [upper]', '=BETA.DIST(0.5, 2, 2, TRUE) gives 0.5'],
  ['BETA.INV', 'probability alpha beta [lower] [upper]', '=BETA.INV(0.5, 2, 2) gives 0.5'],
  ['BINOM.DIST', 'successes trials probability cumulative:b', '=BINOM.DIST(1, 2, 0.5, FALSE) gives 0.5'],
  ['BINOM.DIST.RANGE', 'trials probability successes [successes2]', '=BINOM.DIST.RANGE(2, 0.5, 0, 1) gives 0.75'],
  ['BINOM.INV', 'trials probability alpha', '=BINOM.INV(2, 0.5, 0.5) gives 1'],
  ['CHISQ.DIST', 'x degrees cumulative:b', '=CHISQ.DIST(0, 2, TRUE) gives 0'],
  ['CHISQ.DIST.RT', 'x degrees', '=CHISQ.DIST.RT(0, 2) gives 1'],
  ['CHISQ.INV', 'probability degrees', '=CHISQ.INV(0, 2) gives 0'],
  ['CHISQ.INV.RT', 'probability degrees', '=CHISQ.INV.RT(1, 2) gives 0'],
  ['CHISQ.TEST', 'actual:a expected:a', '=CHISQ.TEST({10, 10}, {10, 10}) gives 1'],
  ['CONFIDENCE.NORM', 'alpha sd size', '=CONFIDENCE.NORM(0.05, 1, 1) gives 1.95996398454005'],
  ['CONFIDENCE.T', 'alpha sd size', '=CONFIDENCE.T(0.05, 1, 2) gives 8.98472'],
  ['EXPON.DIST', 'x lambda cumulative:b', '=EXPON.DIST(0, 2, FALSE) gives 2'],
  ['F.DIST', 'x degrees1 degrees2 cumulative:b', '=F.DIST(1, 2, 2, TRUE) gives 0.5'],
  ['F.DIST.RT', 'x degrees1 degrees2', '=F.DIST.RT(1, 2, 2) gives 0.5'],
  ['F.INV', 'probability degrees1 degrees2', '=F.INV(0.5, 2, 2) gives 1'],
  ['F.INV.RT', 'probability degrees1 degrees2', '=F.INV.RT(0.5, 2, 2) gives 1'],
  ['F.TEST', 'array1:a array2:a', '=F.TEST({1, 2, 3}, {2, 3, 4}) gives 1'],
  ['GAMMA.DIST', 'x alpha beta cumulative:b', '=GAMMA.DIST(0, 1, 1, FALSE) gives 1'],
  ['GAMMA.INV', 'probability alpha beta', '=GAMMA.INV(0, 1, 1) gives 0'],
  ['GAUSS', 'z', '=GAUSS(0) gives 0'],
  ['HYPGEOM.DIST', 'sampleS sample populationS population cumulative:b', '=HYPGEOM.DIST(1, 1, 1, 2, FALSE) gives 0.5'],
  ['LOGNORM.DIST', 'x mean sd cumulative:b', '=LOGNORM.DIST(1, 0, 1, TRUE) gives 0.5'],
  ['LOGNORM.INV', 'probability mean sd', '=LOGNORM.INV(0.5, 0, 1) gives 1'],
  ['NEGBINOM.DIST', 'failures successes probability cumulative:b', '=NEGBINOM.DIST(0, 1, 0.5, FALSE) gives 0.5'],
  ['NORM.DIST', 'x mean sd cumulative:b', '=NORM.DIST(5, 5, 2, TRUE) gives 0.5'],
  ['NORM.INV', 'probability mean sd', '=NORM.INV(0.5, 5, 2) gives 5'],
  ['NORM.S.DIST', 'z cumulative:b', '=NORM.S.DIST(0, TRUE) gives 0.5'],
  ['NORM.S.INV', 'probability', '=NORM.S.INV(0.5) gives 0'],
  ['PHI', 'x', '=PHI(0) gives 0.398942280401433'],
  ['POISSON.DIST', 'x mean cumulative:b', '=POISSON.DIST(0, 1, FALSE) gives 0.367879441171442'],
  ['T.DIST', 'x degrees cumulative:b', '=T.DIST(0, 3, TRUE) gives 0.5'],
  ['T.DIST.2T', 'x degrees', '=T.DIST.2T(0, 3) gives 1'],
  ['T.DIST.RT', 'x degrees', '=T.DIST.RT(0, 3) gives 0.5'],
  ['T.INV', 'probability degrees', '=T.INV(0.5, 3) gives 0'],
  ['T.INV.2T', 'probability degrees', '=T.INV.2T(1, 3) gives 0'],
  ['T.TEST', 'array1:a array2:a tails type', '=T.TEST({1, 2, 3}, {1, 2, 3}, 2, 2) gives 1'],
  ['WEIBULL.DIST', 'x alpha beta cumulative:b', '=WEIBULL.DIST(0, 1, 1, TRUE) gives 0'],
  ['Z.TEST', 'array:a x [sigma]', '=Z.TEST({4, 6}, 5) gives 0.5'],
  ['LINEST', 'knownY:a [knownX:a] [const:b] [stats:b]', '=LINEST({3, 5, 7}, {1, 2, 3}) gives 2 and 1'],
  ['LOGEST', 'knownY:a [knownX:a] [const:b] [stats:b]', '=LOGEST({2, 4, 8}, {1, 2, 3}) gives 2 and 1'],
  ['TREND', 'knownY:a [knownX:a] [newX:a] [const:b]', '=TREND({3, 5, 7}, {1, 2, 3}, 4) gives 9'],
  ['GROWTH', 'knownY:a [knownX:a] [newX:a] [const:b]', '=GROWTH({2, 4, 8}, {1, 2, 3}, 4) gives 16'],
  [
    'FORECAST.ETS',
    'target values:a timeline:a [seasonality] [completion] [aggregation]',
    '=FORECAST.ETS(5, {2, 4, 6, 8}, {1, 2, 3, 4}) gives 10',
  ],
  [
    'FORECAST.ETS.CONFINT',
    'target values:a timeline:a [confidence] [seasonality] [completion] [aggregation]',
    '=FORECAST.ETS.CONFINT(5, {2, 4, 6, 8}, {1, 2, 3, 4}) gives 0 for a perfect line',
  ],
  [
    'FORECAST.ETS.SEASONALITY',
    'values:a timeline:a [completion] [aggregation]',
    '=FORECAST.ETS.SEASONALITY({2, 4, 6, 8}, {1, 2, 3, 4}) gives 1',
  ],
  [
    'FORECAST.ETS.STAT',
    'values:a timeline:a statistic [seasonality] [completion] [aggregation]',
    '=FORECAST.ETS.STAT({2, 4, 6, 8}, {1, 2, 3, 4}, 8) gives the step 1',
  ],
];

export const declared: readonly FnSpec2[] = TABLE.map(([name, list, example]) => lazy(S, name, list, example));
