// Aftershock decay by the Omori-Utsu law, n(t) = K / (t + c)^p. The fit is to the cumulative count: the i-th
// aftershock in time order sits at N(tᵢ) = i, where N(t) = K [(t + c)^(1−p) − c^(1−p)] / (1 − p), and K, c, and p
// come from Levenberg-Marquardt with c and K kept above 0. Times are in any one unit (days, as a rule).
import { levenbergMarquardt } from '../../subjects/num/lm';
import { check, Problem } from '../core/problem';

export interface OmoriFit {
  k: number;
  c: number;
  p: number;
  /** Standard errors of K, c, and p from the fit's covariance. */
  se: [number, number, number];
  /** The sorted times that were fitted. */
  times: number[];
}

/** The expected number of aftershocks from 0 to t: K c^q expm1(q ln(1 + t/c)) / q with q = 1 − p, ln at q = 0. */
export function omoriCount(t: number, k: number, c: number, p: number): number {
  const q = 1 - p;
  const log = Math.log1p(t / c);
  return Math.abs(q) < 1e-12 ? k * log : (k * c ** q * Math.expm1(q * log)) / q;
}

/** The aftershock rate n(t) = K / (t + c)^p. */
export const omoriRate = (t: number, k: number, c: number, p: number): number => k / (t + c) ** p;

/** Fits K, c, and p to aftershock times after the mainshock, from a starting c and p. */
export function omoriUtsu(times: readonly number[], start: { c?: number; p?: number } = {}): OmoriFit {
  check(times.length >= 5, 'aftershocks');
  check(
    times.every((v) => Number.isFinite(v) && v > 0),
    'afterMain',
  );
  const sorted = [...times].sort((a, b) => a - b);
  const counts = sorted.map((_, i) => i + 1);
  const c0 = start.c ?? Math.max(sorted[0], sorted[sorted.length - 1] * 1e-3);
  const p0 = start.p ?? 1.1;
  const k0 = sorted.length / omoriCount(sorted[sorted.length - 1], 1, c0, p0);
  const model = (t: number, x: readonly number[]) => omoriCount(t, x[0], x[1], x[2]);
  let fit;
  try {
    fit = levenbergMarquardt(model, sorted, counts, [k0, c0, p0], {
      lower: [1e-12, 1e-9 * sorted[sorted.length - 1], 0.2],
      upper: [Number.POSITIVE_INFINITY, sorted[sorted.length - 1], 3],
      maxIterations: 500,
    });
  } catch {
    throw new Problem('omoriFit');
  }
  const [k, c, p] = fit.params;
  return {
    k,
    c,
    p,
    se: [fit.se[0], fit.se[1], fit.se[2]],
    times: sorted,
  };
}
