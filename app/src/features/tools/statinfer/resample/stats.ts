// Resampling and simulation, all from a seeded generator so a result can be reproduced from its seed: bootstrap
// intervals (percentile, basic, BCa), permutation tests (exact when the arrangements are few, else Monte Carlo),
// the sampling-distribution lab, and coin, dice, urn, random-walk, and Brownian-motion simulations.
import { Rng } from '../../subjects/num/rng';
import { normalCdf, normalQuantile, tQuantile } from '../../subjects/stats/dist';
import type { Alternative } from '../../subjects/stats/dist';
import { quantile } from '../num/data';
import { check } from '../report';

/** The most data values times resamples one run works through, so the window stays responsive. */
export const MAX_WORK = 20_000_000;
/** Exact enumeration is used up to this many arrangements. */
export const MAX_EXACT = 100_000;

export type Statistic = 'mean' | 'median' | 'sd' | 'trimmed' | 'correlation' | 'diffMeans' | 'diffMedians' | 'ratio';

const mean = (v: readonly number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const sorted = (v: readonly number[]) => [...v].sort((a, b) => a - b);
const median = (v: readonly number[]) => quantile(sorted(v), 0.5);
const sd = (v: readonly number[]) => {
  const m = mean(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
};
const trimmed = (v: readonly number[]) => {
  const s = sorted(v);
  const cut = Math.floor(s.length * 0.1);
  return mean(s.slice(cut, s.length - cut));
};
function correlation(x: readonly number[], y: readonly number[]): number {
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < x.length; i += 1) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : Number.NaN;
}

/** The statistic of a sample `x`, or of two samples (or pairs) `x` and `y`. */
export function statistic(kind: Statistic, x: readonly number[], y: readonly number[]): number {
  switch (kind) {
    case 'mean':
      return mean(x);
    case 'median':
      return median(x);
    case 'sd':
      return sd(x);
    case 'trimmed':
      return trimmed(x);
    case 'correlation':
      return correlation(x, y);
    case 'diffMeans':
      return mean(x) - mean(y);
    case 'diffMedians':
      return median(x) - median(y);
    default:
      return mean(x) / mean(y);
  }
}

export const needsTwo = (kind: Statistic) =>
  kind === 'correlation' || kind === 'diffMeans' || kind === 'diffMedians' || kind === 'ratio';
export const paired = (kind: Statistic) => kind === 'correlation';

export interface Bootstrap {
  readonly observed: number;
  readonly se: number;
  readonly bias: number;
  readonly percentile: readonly [number, number];
  readonly basic: readonly [number, number];
  readonly bca: readonly [number, number] | null;
  readonly z0: number;
  readonly acceleration: number;
  readonly replicates: readonly number[];
}

function checkData(kind: Statistic, x: readonly number[], y: readonly number[]): void {
  check(x.length >= 2, 'tooFew', { min: '2' });
  check([...x, ...y].every(Number.isFinite), 'notNumber', { text: '—' });
  if (needsTwo(kind)) check(y.length >= 2, 'secondSample');
  if (paired(kind)) check(x.length === y.length, 'pairLength');
}

/** The bootstrap of a statistic: B resamples with replacement (pairs together for a correlation). */
export function bootstrap(
  kind: Statistic,
  x: readonly number[],
  y: readonly number[],
  resamples: number,
  seed: bigint,
  confidence = 0.95,
): Bootstrap {
  checkData(kind, x, y);
  check(Number.isInteger(resamples) && resamples >= 100 && resamples <= 1_000_000, 'resamplesRange');
  check(confidence > 0 && confidence < 1, 'confidenceRange');
  check((x.length + y.length) * resamples <= MAX_WORK, 'tooMuchWork');
  const observed = statistic(kind, x, y);
  check(Number.isFinite(observed), 'statisticUndefined');
  const rng = new Rng(seed);
  const replicates: number[] = [];
  const bx = new Array<number>(x.length);
  const by = new Array<number>(y.length);
  for (let b = 0; b < resamples; b += 1) {
    if (paired(kind)) {
      for (let i = 0; i < x.length; i += 1) {
        const pick = rng.integer(x.length);
        bx[i] = x[pick];
        by[i] = y[pick];
      }
    } else {
      for (let i = 0; i < x.length; i += 1) bx[i] = x[rng.integer(x.length)];
      for (let i = 0; i < y.length; i += 1) by[i] = y[rng.integer(y.length)];
    }
    const value = statistic(kind, bx, by);
    if (Number.isFinite(value)) replicates.push(value);
  }
  check(replicates.length > resamples / 2, 'statisticUndefined');
  const s = sorted(replicates);
  const m = mean(replicates);
  const se = Math.sqrt(replicates.reduce((a, v) => a + (v - m) ** 2, 0) / (replicates.length - 1));
  const alpha = 1 - confidence;
  const lo = quantile(s, alpha / 2);
  const hi = quantile(s, 1 - alpha / 2);
  const constant = s[0] === s[s.length - 1];
  let bca: readonly [number, number] | null = null;
  let z0 = Number.NaN;
  let acceleration = Number.NaN;
  if (constant) {
    bca = [observed, observed];
  } else {
    const below = replicates.filter((v) => v < observed).length / replicates.length;
    z0 = normalQuantile(Math.min(1 - 1e-12, Math.max(1e-12, below)));
    acceleration = jackknifeAcceleration(kind, x, y);
    const adjusted = (z: number) => normalCdf(z0 + (z0 + z) / (1 - acceleration * (z0 + z)));
    const zl = normalQuantile(alpha / 2);
    const zh = normalQuantile(1 - alpha / 2);
    if (Number.isFinite(acceleration)) bca = [quantile(s, adjusted(zl)), quantile(s, adjusted(zh))];
  }
  return {
    observed,
    se: constant ? 0 : se,
    bias: m - observed,
    percentile: [lo, hi],
    basic: [2 * observed - hi, 2 * observed - lo],
    bca,
    z0,
    acceleration,
    replicates,
  };
}

/** The BCa acceleration from the jackknife: a = Σ (θ̄ − θᵢ)³ / (6 [Σ (θ̄ − θᵢ)²]^1.5). */
function jackknifeAcceleration(kind: Statistic, x: readonly number[], y: readonly number[]): number {
  const values: number[] = [];
  const leave = (v: readonly number[], i: number) => v.filter((_, j) => j !== i);
  if (paired(kind)) {
    for (let i = 0; i < x.length; i += 1) values.push(statistic(kind, leave(x, i), leave(y, i)));
  } else {
    for (let i = 0; i < x.length; i += 1) values.push(statistic(kind, leave(x, i), y));
    if (needsTwo(kind)) for (let i = 0; i < y.length; i += 1) values.push(statistic(kind, x, leave(y, i)));
  }
  const finite = values.filter(Number.isFinite);
  const m = mean(finite);
  const s2 = finite.reduce((a, v) => a + (m - v) ** 2, 0);
  const s3 = finite.reduce((a, v) => a + (m - v) ** 3, 0);
  return s2 > 0 ? s3 / (6 * s2 ** 1.5) : 0;
}

export interface Permutation {
  readonly observed: number;
  readonly p: number;
  readonly exact: boolean;
  readonly count: number;
  readonly total: number;
  readonly se: number;
  readonly values: readonly number[];
}

export type PermutationKind = 'twoSample' | 'paired' | 'correlation';

function binomial(n: number, k: number): number {
  let c = 1;
  for (let i = 1; i <= k; i += 1) c = (c * (n - k + i)) / i;
  return c;
}

function factorial(n: number): number {
  let f = 1;
  for (let i = 2; i <= n; i += 1) f *= i;
  return f;
}

const exceeds = (value: number, observed: number, alternative: Alternative) => {
  const tol = 1e-9 * Math.max(1, Math.abs(observed));
  if (alternative === 'greater') return value >= observed - tol;
  if (alternative === 'less') return value <= observed + tol;
  return Math.abs(value) >= Math.abs(observed) - tol;
};

/** Every way to choose k of n indexes, in order, passed to `visit`. */
function combinations(n: number, k: number, visit: (chosen: readonly number[]) => void): void {
  const chosen: number[] = [];
  const walk = (start: number) => {
    if (chosen.length === k) {
      visit(chosen);
      return;
    }
    for (let i = start; i <= n - (k - chosen.length); i += 1) {
      chosen.push(i);
      walk(i + 1);
      chosen.pop();
    }
  };
  walk(0);
}

function permutations(items: number[], visit: (order: readonly number[]) => void, k = 0): void {
  if (k === items.length) {
    visit(items);
    return;
  }
  for (let i = k; i < items.length; i += 1) {
    [items[k], items[i]] = [items[i], items[k]];
    permutations(items, visit, k + 1);
    [items[k], items[i]] = [items[i], items[k]];
  }
}

/**
 * A permutation test: the difference in means of two samples, the mean of paired differences (sign flips), or a
 * correlation (one column shuffled). Exact over every arrangement when there are at most 100 000.
 */
export function permutationTest(
  kind: PermutationKind,
  x: readonly number[],
  y: readonly number[],
  alternative: Alternative,
  resamples: number,
  seed: bigint,
): Permutation {
  check(x.length >= 2, 'tooFew', { min: '2' });
  check([...x, ...y].every(Number.isFinite), 'notNumber', { text: '—' });
  if (kind !== 'paired') check(y.length >= 2, 'secondSample');
  if (kind === 'correlation') check(x.length === y.length, 'pairLength');
  const all = [...x, ...y];
  const stat = (
    indexes: readonly number[] | null,
    signs: readonly number[] | null,
    order: readonly number[] | null,
  ): number => {
    if (kind === 'paired') return mean(x.map((d, i) => d * (signs ? signs[i] : 1)));
    if (kind === 'correlation') return correlation(x, order ? order.map((i) => y[i]) : y);
    if (!indexes) return mean(x) - mean(y);
    const inFirst = new Set(indexes);
    let s1 = 0;
    let s2 = 0;
    all.forEach((v, i) => (inFirst.has(i) ? (s1 += v) : (s2 += v)));
    return s1 / x.length - s2 / y.length;
  };
  const observed = stat(null, null, null);
  check(Number.isFinite(observed), 'statisticUndefined');
  const total =
    kind === 'paired' ? 2 ** x.length : kind === 'correlation' ? factorial(x.length) : binomial(all.length, x.length);
  const values: number[] = [];
  const keep = (v: number) => {
    if (values.length < 20_000) values.push(v);
  };
  let count = 0;
  if (total <= MAX_EXACT) {
    if (kind === 'paired') {
      for (let mask = 0; mask < total; mask += 1) {
        const v = stat(
          null,
          x.map((_, i) => ((mask >> i) & 1 ? -1 : 1)),
          null,
        );
        keep(v);
        if (exceeds(v, observed, alternative)) count += 1;
      }
    } else if (kind === 'correlation') {
      permutations(
        y.map((_, i) => i),
        (order) => {
          const v = stat(null, null, order);
          keep(v);
          if (exceeds(v, observed, alternative)) count += 1;
        },
      );
    } else {
      combinations(all.length, x.length, (chosen) => {
        const v = stat(chosen, null, null);
        keep(v);
        if (exceeds(v, observed, alternative)) count += 1;
      });
    }
    return { observed, p: count / total, exact: true, count, total, se: 0, values };
  }
  check(Number.isInteger(resamples) && resamples >= 100 && resamples <= 1_000_000, 'resamplesRange');
  check(all.length * resamples <= MAX_WORK, 'tooMuchWork');
  const rng = new Rng(seed);
  const indexes = all.map((_, i) => i);
  for (let b = 0; b < resamples; b += 1) {
    let v: number;
    if (kind === 'paired')
      v = stat(
        null,
        x.map(() => (rng.uniform() < 0.5 ? -1 : 1)),
        null,
      );
    else if (kind === 'correlation') v = stat(null, null, rng.shuffle(y.map((_, i) => i)));
    else v = stat(rng.shuffle(indexes).slice(0, x.length), null, null);
    keep(v);
    if (exceeds(v, observed, alternative)) count += 1;
  }
  const p = (count + 1) / (resamples + 1);
  return { observed, p, exact: false, count, total: resamples, se: Math.sqrt((p * (1 - p)) / resamples), values };
}

export type Population = 'normal' | 'uniform' | 'exponential' | 'bernoulli' | 'pasted';

export interface Lab {
  readonly means: readonly number[];
  readonly populationMean: number;
  readonly populationSd: number;
  readonly coverage: number;
  readonly meanOfMeans: number;
  readonly sdOfMeans: number;
}

/**
 * The sampling-distribution lab: draw `reps` samples of size n from a population, keep each sample mean (a
 * proportion for 0-1 data), and count how many 95% t intervals cover the population mean.
 */
export function samplingLab(
  population: Population,
  parameter: number,
  pasted: readonly number[],
  n: number,
  reps: number,
  seed: bigint,
): Lab {
  check(Number.isInteger(n) && n >= 2 && n <= 10_000, 'sampleSize');
  check(Number.isInteger(reps) && reps >= 10 && reps <= 100_000, 'repsRange');
  check(n * reps <= MAX_WORK, 'tooMuchWork');
  if (population === 'pasted') check(pasted.length >= 2, 'populationEmpty');
  if (population === 'bernoulli') check(parameter >= 0 && parameter <= 1, 'probabilityRange', { name: 'p' });
  if (population === 'exponential') check(parameter > 0, 'positiveParameter');
  const rng = new Rng(seed);
  const draw = (): number => {
    if (population === 'normal') return rng.normal(0, 1);
    if (population === 'uniform') return rng.uniform();
    if (population === 'exponential') return rng.exponential(parameter);
    if (population === 'bernoulli') return rng.uniform() < parameter ? 1 : 0;
    return pasted[rng.integer(pasted.length)];
  };
  const truth =
    population === 'normal'
      ? { m: 0, s: 1 }
      : population === 'uniform'
        ? { m: 0.5, s: Math.sqrt(1 / 12) }
        : population === 'exponential'
          ? { m: 1 / parameter, s: 1 / parameter }
          : population === 'bernoulli'
            ? { m: parameter, s: Math.sqrt(parameter * (1 - parameter)) }
            : {
                m: mean(pasted),
                s: Math.sqrt(pasted.reduce((a, v) => a + (v - mean(pasted)) ** 2, 0) / pasted.length),
              };
  const t = tQuantile(0.975, n - 1);
  const means: number[] = [];
  let covered = 0;
  const sample = new Array<number>(n);
  for (let r = 0; r < reps; r += 1) {
    for (let i = 0; i < n; i += 1) sample[i] = draw();
    const m = mean(sample);
    const half = (t * sd(sample)) / Math.sqrt(n);
    if (Math.abs(m - truth.m) <= half) covered += 1;
    means.push(m);
  }
  const mm = mean(means);
  return {
    means,
    populationMean: truth.m,
    populationSd: truth.s,
    coverage: covered / reps,
    meanOfMeans: mm,
    sdOfMeans: Math.sqrt(means.reduce((a, v) => a + (v - mm) ** 2, 0) / (means.length - 1)),
  };
}

export type Simulation = 'coin' | 'dice' | 'urn' | 'walk' | 'brownian';

export interface SimulationResult {
  /** The running value (proportion of heads, walk position, path) after each step. */
  readonly path: readonly number[];
  /** Counts of each outcome, for dice sums and urn draws. */
  readonly counts: readonly number[];
  readonly final: number;
}

/** Coin flips (running proportion), sums of dice, draws from an urn, a random walk, or a Brownian path. */
export function simulate(
  kind: Simulation,
  steps: number,
  p: number,
  dice: number,
  urn: readonly [number, number],
  seed: bigint,
): SimulationResult {
  check(Number.isInteger(steps) && steps >= 1 && steps <= 1_000_000, 'stepsRange');
  const rng = new Rng(seed);
  if (kind === 'coin' || kind === 'walk') {
    check(p >= 0 && p <= 1, 'probabilityRange', { name: 'p' });
    let heads = 0;
    let position = 0;
    const path: number[] = [];
    for (let i = 1; i <= steps; i += 1) {
      const up = rng.uniform() < p;
      heads += up ? 1 : 0;
      position += up ? 1 : -1;
      path.push(kind === 'coin' ? heads / i : position);
    }
    return { path, counts: [heads, steps - heads], final: path[path.length - 1] };
  }
  if (kind === 'dice') {
    check(Number.isInteger(dice) && dice >= 1 && dice <= 20, 'diceRange');
    const counts = new Array<number>(5 * dice + 1).fill(0);
    for (let i = 0; i < steps; i += 1) {
      let total = 0;
      for (let d = 0; d < dice; d += 1) total += 1 + rng.integer(6);
      counts[total - dice] += 1;
    }
    return { path: [], counts, final: counts.indexOf(Math.max(...counts)) + dice };
  }
  if (kind === 'urn') {
    const [red, blue] = urn;
    check(Number.isInteger(red) && Number.isInteger(blue) && red >= 0 && blue >= 0 && red + blue >= 1, 'urnRange');
    check(steps <= red + blue, 'urnDraws');
    const balls = [...new Array<number>(red).fill(1), ...new Array<number>(blue).fill(0)];
    const drawn = rng.sample(balls, steps);
    let reds = 0;
    const path = drawn.map((b) => (reds += b));
    return { path, counts: [reds, steps - reds], final: reds };
  }
  // A Brownian path on [0, 1]: independent normal steps with variance 1/steps.
  let w = 0;
  const path = [0];
  for (let i = 0; i < steps; i += 1) {
    w += rng.normal(0, Math.sqrt(1 / steps));
    path.push(w);
  }
  return { path, counts: [], final: w };
}
