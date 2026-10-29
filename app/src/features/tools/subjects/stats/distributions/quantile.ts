// Inverting a distribution function: bracket the answer, then Brent's method from the kit numerics. A probability
// above one half is solved on the upper tail, so quantiles far out in the upper tail keep their accuracy.
import { brent } from '../../../kits/num/roots';
import { SubjectError, ensure } from '../../errors';

export interface Support {
  lo: number;
  hi: number;
}

/** Throws unless p is a probability strictly between 0 and 1 (0 and 1 map to the ends of the support). */
export function checkProbability(p: number): void {
  ensure(p >= 0 && p <= 1, 'domain', 'p');
}

/**
 * The x with cdf(x) = p, for a continuous distribution on `support`. `guess` starts the bracket. The tolerance is
 * relative (1e-14 of |x|, or absolute near zero), well inside the 1e-10 target of the central distributions.
 */
export function continuousQuantile(
  cdf: (x: number) => number,
  sf: (x: number) => number,
  p: number,
  support: Support,
  guess: number,
): number {
  checkProbability(p);
  if (p === 0) return support.lo;
  if (p === 1) return support.hi;
  const upper = p > 0.5;
  const g = upper ? (x: number) => 1 - p - sf(x) : (x: number) => cdf(x) - p;
  const [a, b] = bracket(g, support, guess);
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return brent(g, a, b, 1e-15 * scale, 400).x;
}

/** An interval [a, b] inside the support where the increasing function g changes sign. */
function bracket(g: (x: number) => number, support: Support, guess: number): [number, number] {
  let x = Math.min(Math.max(guess, support.lo), support.hi);
  if (!Number.isFinite(x)) x = 0;
  const step0 = Math.max(1, Math.abs(x));
  if (g(x) < 0) {
    for (let step = step0; step < 1e300; step *= 2) {
      const next = Math.min(support.hi, x + step);
      if (g(next) >= 0) return [x, next];
      if (next === support.hi) break;
      x = next;
    }
  } else {
    for (let step = step0; step < 1e300; step *= 2) {
      const next = Math.max(support.lo, x - step);
      if (g(next) <= 0) return [next, x];
      if (next === support.lo) break;
      x = next;
    }
  }
  throw new SubjectError('noBracket', 'quantile');
}

/** The smallest whole k in [lo, hi] with cdf(k) ≥ p, by doubling then bisection. */
export function discreteQuantile(cdf: (k: number) => number, p: number, lo: number, hi: number, guess: number): number {
  checkProbability(p);
  if (p === 0) return lo;
  let low = lo;
  let high = Math.min(hi, Math.max(lo, Math.round(guess)));
  for (let step = 1; cdf(high) < p; step *= 2) {
    if (high >= hi) return hi;
    low = high + 1;
    high = Math.min(hi, high + step);
  }
  // Now cdf(high) >= p; find the smallest such k in [low, high].
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (cdf(mid) >= p) high = mid;
    else low = mid + 1;
  }
  return high;
}
