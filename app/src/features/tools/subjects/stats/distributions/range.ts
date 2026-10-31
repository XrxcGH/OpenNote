// The studentized range distribution, for Tukey's HSD and other multiple comparisons. P(Q ≤ q) for k means and df
// error degrees of freedom is a double integral (Copenhaver and Holland, 1988). The inner integral is the range of
// k standard normals, W(w) = k ∫ φ(z) [Φ(z) − Φ(z − w)]^(k−1) dz. The outer one averages W(q s) over s, the
// square root of a chi-square over df. Both use Gauss-Legendre rules on pieces. Accuracy target: 1e-8 absolute.
import { gaussLegendre } from '../../../kits/num/quad';
import { lgamma } from '../../../kits/num/special';
import { SubjectError, ensure } from '../../errors';
import { chiSquareQuantile, normalCdf } from './continuous';

const GL = gaussLegendre(20);
const SQRT_2PI = Math.sqrt(2 * Math.PI);

/** Σ over `pieces` equal parts of [a, b] of the 20-point Gauss-Legendre rule. */
function composite(f: (x: number) => number, a: number, b: number, pieces: number): number {
  const h = (b - a) / pieces;
  let sum = 0;
  for (let p = 0; p < pieces; p += 1) {
    const mid = a + (p + 0.5) * h;
    for (let i = 0; i < GL.nodes.length; i += 1) sum += GL.weights[i] * f(mid + (h / 2) * GL.nodes[i]);
  }
  return (sum * h) / 2;
}

/**
 * The inner rule's fixed nodes on [−9, 9] (36 pieces of 20 points), with φ(z) and the rule weight folded together
 * and Φ(z) kept, so each W(w) costs one Φ(z − w) per node.
 */
const INNER = (() => {
  const pieces = 36;
  const h = 18 / pieces;
  const z: number[] = [];
  const c: number[] = [];
  const cdf: number[] = [];
  for (let p = 0; p < pieces; p += 1) {
    const mid = -9 + (p + 0.5) * h;
    GL.nodes.forEach((node, i) => {
      const x = mid + (h / 2) * node;
      z.push(x);
      c.push(((GL.weights[i] * h) / 2) * (Math.exp(-0.5 * x * x) / SQRT_2PI));
      cdf.push(normalCdf(x));
    });
  }
  return { z, c, cdf };
})();

/** P(range of k standard normals ≤ w) = k ∫ φ(z) [Φ(z) − Φ(z − w)]^(k−1) dz, with z the largest of the k. */
export function normalRangeCdf(w: number, k: number): number {
  ensure(Number.isInteger(k) && k >= 2, 'domain', 'k');
  if (w <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < INNER.z.length; i += 1) {
    const inner = INNER.cdf[i] - normalCdf(INNER.z[i] - w);
    if (inner > 0) sum += INNER.c[i] * Math.pow(inner, k - 1);
  }
  return Math.min(1, Math.max(0, k * sum));
}

/** ln of the density of s = √(χ²_df / df). */
function logChiDensity(s: number, df: number): number {
  const h = df / 2;
  return h * Math.log(h) + Math.LN2 - lgamma(h) + (df - 1) * Math.log(s) - h * s * s;
}

/** P(Q ≤ q) for the studentized range of k means with df degrees of freedom (df may be Infinity). */
export function studentizedRangeCdf(q: number, k: number, df: number): number {
  ensure(Number.isInteger(k) && k >= 2, 'domain', 'k');
  ensure(df >= 1, 'domain', 'df');
  if (q <= 0) return 0;
  if (!Number.isFinite(df) || df > 50_000) return normalRangeCdf(q, k);
  // s lies between these chi quantiles with all but 2e-15 of its probability.
  const lo = Math.sqrt(chiSquareQuantile(1e-15, df) / df);
  const hi = Math.sqrt(chiSquareQuantile(1 - 1e-15, df) / df);
  const f = (s: number) => Math.exp(logChiDensity(s, df)) * normalRangeCdf(q * s, k);
  return Math.min(1, Math.max(0, composite(f, lo, hi, 16)));
}

/** The q with P(Q ≤ q) = p, by bisection then the secant rule on the cdf (it is smooth and increasing). */
export function studentizedRangeQuantile(p: number, k: number, df: number): number {
  ensure(p > 0 && p < 1, 'domain', 'p');
  const g = (q: number) => studentizedRangeCdf(q, k, df) - p;
  let lo = 0;
  let hi = 4;
  while (g(hi) < 0) {
    lo = hi;
    hi *= 2;
    if (hi > 1e4) throw new SubjectError('noBracket', 'studentized range');
  }
  let [glo, ghi] = [-p, g(hi)];
  for (let i = 0; i < 100 && hi - lo > 1e-11 * hi; i += 1) {
    const secant = hi - (ghi * (hi - lo)) / (ghi - glo);
    const mid = secant > lo && secant < hi && i % 3 !== 2 ? secant : (lo + hi) / 2;
    const gm = g(mid);
    if (gm < 0) [lo, glo] = [mid, gm];
    else [hi, ghi] = [mid, gm];
  }
  return (lo + hi) / 2;
}
