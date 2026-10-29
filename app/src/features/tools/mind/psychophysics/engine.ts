// Psychophysics. Psychometric functions (logistic, cumulative Gaussian, Weibull) with a guess rate and a fixed or
// free lapse rate, fitted by maximum likelihood, with thresholds, slopes, PSE and JND, and seeded parametric-
// bootstrap intervals. Transformed and weighted up-down staircases, simulated or typed. The methods of limits and
// adjustment, Weber's and Fechner's laws, Stevens' power law, and the visual measures: visual angle, spatial
// frequency, Michelson, Weber, and RMS contrast, and Snellen to logMAR and decimal acuity.
import { lineFit, mean, nelderMead, normCdf, normPdf, normQuantile, quantile, sd } from '../kit/num';
import type { Rng } from '../kit/rng';
import { fail } from '../kit/types';

export type Shape = 'logistic' | 'gaussian' | 'weibull';

/** F(x; alpha, beta) from 0 to 1. Beta is the slope: 1/SD for the Gaussian, the exponent for the Weibull. */
export function sigmoid(x: number, shape: Shape, alpha: number, beta: number): number {
  if (shape === 'logistic') return 1 / (1 + Math.exp(-beta * (x - alpha)));
  if (shape === 'gaussian') return normCdf(beta * (x - alpha));
  return x <= 0 ? 0 : 1 - Math.exp(-Math.pow(x / alpha, beta));
}

/** The x where F reaches f, between 0 and 1. */
export function sigmoidInverse(f: number, shape: Shape, alpha: number, beta: number): number {
  if (shape === 'logistic') return alpha + Math.log(f / (1 - f)) / beta;
  if (shape === 'gaussian') return alpha + normQuantile(f) / beta;
  return alpha * Math.pow(-Math.log(1 - f), 1 / beta);
}

/** dF/dx. */
export function sigmoidSlope(x: number, shape: Shape, alpha: number, beta: number): number {
  if (shape === 'logistic') {
    const f = sigmoid(x, shape, alpha, beta);
    return beta * f * (1 - f);
  }
  if (shape === 'gaussian') return beta * normPdf(beta * (x - alpha));
  if (x <= 0) return 0;
  const u = Math.pow(x / alpha, beta);
  return (beta / x) * u * Math.exp(-u);
}

export interface Psi {
  readonly shape: Shape;
  readonly alpha: number;
  readonly beta: number;
  readonly gamma: number;
  readonly lambda: number;
}

/** psi(x) = gamma + (1 - gamma - lambda) F(x). */
export const psi = (x: number, p: Psi): number =>
  p.gamma + (1 - p.gamma - p.lambda) * sigmoid(x, p.shape, p.alpha, p.beta);

export interface Point {
  readonly x: number;
  readonly k: number;
  readonly n: number;
}

export function logLikelihood(points: readonly Point[], p: Psi): number {
  let total = 0;
  for (const { x, k, n } of points) {
    const q = Math.min(1 - 1e-12, Math.max(1e-12, psi(x, p)));
    total += k * Math.log(q) + (n - k) * Math.log(1 - q);
  }
  return total;
}

export const MAX_LAPSE = 0.06;

export interface Fit extends Psi {
  readonly logLik: number;
  /** The log-likelihood of the saturated model, for the deviance. */
  readonly saturated: number;
  readonly deviance: number;
}

export function checkPoints(points: readonly Point[], shape: Shape): void {
  if (points.length < 2) fail('fewLevels', {}, 'data');
  points.forEach(({ x, k, n }, i) => {
    if (!(n > 0)) fail('trialsPositive', { line: i + 1 }, 'data');
    if (!(k >= 0 && k <= n)) fail('correctTrials', { line: i + 1 }, 'data');
    if (shape === 'weibull' && !(x > 0)) fail('weibullLevel', { line: i + 1 }, 'data');
  });
  if (new Set(points.map((p) => p.x)).size < 2) fail('fewLevels', {}, 'data');
}

/**
 * The maximum-likelihood fit of alpha and beta (and lambda when it is free, from 0 to 0.06), by Nelder-Mead from
 * several starts. Counts need not be whole, so expected counts can be fitted.
 */
export function fitPsi(points: readonly Point[], shape: Shape, gamma: number, lambda: number | 'free'): Fit {
  checkPoints(points, shape);
  if (!(gamma >= 0 && gamma < 1)) fail('range', { low: 0, high: 0.99 }, 'gamma');
  const xs = points.map((p) => p.x);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const free = lambda === 'free';
  const fixedLapse = free ? 0 : lambda;
  if (!free && !(fixedLapse >= 0 && gamma + fixedLapse < 1)) fail('range', { low: 0, high: MAX_LAPSE }, 'lambda');
  const unpack = (v: readonly number[]): Psi => ({
    shape,
    alpha: shape === 'weibull' ? Math.exp(v[0]) : v[0],
    beta: Math.exp(v[1]),
    gamma,
    lambda: free ? MAX_LAPSE / (1 + Math.exp(-v[2])) : fixedLapse,
  });
  const nll = (v: number[]) => -logLikelihood(points, unpack(v));
  const span = hi - lo;
  const best = [0.25, 0.5, 0.75]
    .flatMap((at) =>
      [0.5, 2, 8].map((spread) => {
        const a = lo + at * span;
        const b = spread / span;
        const start = [
          shape === 'weibull' ? Math.log(a) : a,
          Math.log(shape === 'weibull' ? spread : b),
          ...(free ? [-2] : []),
        ];
        return nelderMead(nll, start, [shape === 'weibull' ? 0.3 : span / 4, 0.5, ...(free ? [1] : [])]);
      }),
    )
    .reduce((p, q) => (q.value < p.value ? q : p));
  const fit = unpack(best.x);
  let saturated = 0;
  for (const { k, n } of points) {
    const q = k / n;
    if (q > 0) saturated += k * Math.log(q);
    if (q < 1) saturated += (n - k) * Math.log(1 - q);
  }
  return { ...fit, logLik: -best.value, saturated, deviance: 2 * (saturated + best.value) };
}

/** The level where psi reaches `level`; NaN when psi never does. */
export function threshold(p: Psi, level: number): number {
  const f = (level - p.gamma) / (1 - p.gamma - p.lambda);
  if (!(f > 0 && f < 1)) return NaN;
  return sigmoidInverse(f, p.shape, p.alpha, p.beta);
}

/** dpsi/dx at x. */
export const psiSlope = (x: number, p: Psi): number =>
  (1 - p.gamma - p.lambda) * sigmoidSlope(x, p.shape, p.alpha, p.beta);

export interface Interval {
  readonly low: number;
  readonly high: number;
  readonly used: number;
}

/**
 * Parametric bootstrap: draw new counts from the fitted function at each level, refit, and take the 2.5% and
 * 97.5% points of the threshold and the slope parameter. Counts are rounded to whole trials for the draws.
 */
export function bootstrap(
  points: readonly Point[],
  fit: Fit,
  lambda: number | 'free',
  level: number,
  draws: number,
  rng: Rng,
): { threshold: Interval; beta: Interval } {
  const ts: number[] = [];
  const bs: number[] = [];
  for (let i = 0; i < draws; i += 1) {
    const sample = points.map(({ x, n }) => {
      const trials = Math.max(1, Math.round(n));
      return { x, n: trials, k: rng.binomial(trials, psi(x, fit)) };
    });
    try {
      const again = fitPsi(sample, fit.shape, fit.gamma, lambda);
      const t = threshold(again, level);
      if (Number.isFinite(t)) ts.push(t);
      bs.push(again.beta);
    } catch {
      // A draw that cannot be fitted is left out; the count says how many were used.
    }
  }
  const interval = (xs: number[]): Interval =>
    xs.length === 0
      ? { low: NaN, high: NaN, used: 0 }
      : { low: quantile(xs, 0.025), high: quantile(xs, 0.975), used: xs.length };
  return { threshold: interval(ts), beta: interval(bs) };
}

/** The proportion correct a 1-up-n-down rule converges on: 0.5^(1/n). */
export const convergence = (down: number): number => Math.pow(0.5, 1 / down);

/** The step up for a weighted 1-up-1-down rule (Kaernbach 1991) that targets p, with a step down of 1. */
export const weightedUp = (p: number): number => p / (1 - p);

export interface Track {
  readonly levels: readonly number[];
  readonly responses: readonly boolean[];
  /** Trial indices where the direction of the track changed. */
  readonly reversals: readonly number[];
}

/** The reversals of a track: trials where its level starts moving the other way. */
export function reversalsOf(levels: readonly number[]): number[] {
  const out: number[] = [];
  let direction = 0;
  for (let i = 1; i < levels.length; i += 1) {
    const d = Math.sign(levels[i] - levels[i - 1]);
    if (d === 0) continue;
    if (direction !== 0 && d !== direction) out.push(i - 1);
    direction = d;
  }
  return out;
}

export interface Staircase {
  readonly start: number;
  readonly stepDown: number;
  readonly stepUp: number;
  /** Correct answers in a row before the level goes down. */
  readonly down: number;
  readonly trials: number;
  /** Levels are clamped here. */
  readonly floor: number;
}

/** Runs a staircase with a simulated observer whose chance of a correct answer at a level is psi. */
export function simulateStaircase(rule: Staircase, observer: Psi, rng: Rng): Track {
  const levels: number[] = [];
  const responses: boolean[] = [];
  let level = rule.start;
  let run = 0;
  for (let i = 0; i < rule.trials; i += 1) {
    levels.push(level);
    const correct = rng.next() < psi(level, observer);
    responses.push(correct);
    if (correct) {
      run += 1;
      if (run >= rule.down) {
        level = Math.max(rule.floor, level - rule.stepDown);
        run = 0;
      }
    } else {
      level += rule.stepUp;
      run = 0;
    }
  }
  return { levels, responses, reversals: reversalsOf(levels) };
}

/** The mean of the levels at the last k reversals (all of them when there are fewer). */
export function staircaseThreshold(
  track: Pick<Track, 'levels' | 'reversals'>,
  last: number,
): { value: number; used: number } {
  if (track.reversals.length === 0) fail('noReversals', {}, 'track');
  const used = track.reversals.slice(-last).map((i) => track.levels[i]);
  return { value: mean(used), used: used.length };
}

/** Weber fractions k = dI/I for each line, and the least-squares k for dI = k I through the origin. */
export function weber(pairs: readonly (readonly number[])[]): { each: number[]; k: number } {
  if (pairs.length === 0) fail('empty', {}, 'weber');
  pairs.forEach(([i, d], line) => {
    if (!(i > 0) || !(d > 0)) fail('weberRow', { line: line + 1 }, 'weber');
  });
  const each = pairs.map(([i, d]) => d / i);
  const k = pairs.reduce((s, [i, d]) => s + i * d, 0) / pairs.reduce((s, [i]) => s + i * i, 0);
  return { each, k };
}

/** Just-noticeable steps from I0 to I when each step is a factor of (1 + k): Fechner's law, counted exactly. */
export const fechnerSteps = (i0: number, i: number, k: number): number => Math.log(i / i0) / Math.log(1 + k);

/** Stevens' power law psi = k S^n, fitted by least squares on log-log axes. */
export function stevens(pairs: readonly (readonly number[])[]): { n: number; k: number; r2: number } {
  if (pairs.length < 2) fail('fewPoints', { low: 2 }, 'stevens');
  pairs.forEach(([s, p], line) => {
    if (!(s > 0) || !(p > 0)) fail('stevensRow', { line: line + 1 }, 'stevens');
  });
  const fit = lineFit(
    pairs.map(([s]) => Math.log(s)),
    pairs.map(([, p]) => Math.log(p)),
  );
  if (Number.isNaN(fit.slope)) fail('sameId', {}, 'stevens');
  return { n: fit.slope, k: Math.exp(fit.intercept), r2: fit.r2 };
}

const DEG = 180 / Math.PI;

/** The angle in degrees that an object of size s subtends at distance d (same units). */
export const visualAngle = (s: number, d: number): number => 2 * Math.atan(s / (2 * d)) * DEG;
/** The size that subtends an angle in degrees at distance d. */
export const sizeForAngle = (deg: number, d: number): number => 2 * d * Math.tan(deg / DEG / 2);

export const michelson = (lmax: number, lmin: number): number => (lmax - lmin) / (lmax + lmin);
export const weberContrast = (target: number, background: number): number => (target - background) / background;
/** RMS contrast: the SD of the luminances (population form) over their mean. */
export const rmsContrast = (ls: readonly number[]): number => sd(ls, true) / mean(ls);

/** Snellen acuity as a fraction (20/40 or 6/12) to logMAR and decimal acuity. */
export function snellen(numerator: number, denominator: number): { logMar: number; decimal: number; mar: number } {
  if (!(numerator > 0) || !(denominator > 0)) fail('positive', {}, 'snellen');
  return {
    logMar: Math.log10(denominator / numerator),
    decimal: numerator / denominator,
    mar: denominator / numerator,
  };
}
