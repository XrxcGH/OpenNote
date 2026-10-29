// The central continuous distributions every statistics tool needs: normal, Student t, chi-square, F, beta, gamma,
// and exponential, each with its density, distribution function (cdf), survival function (sf = 1 - cdf, computed
// directly so small upper tails stay accurate), and quantile. They are written on the kit special functions: the
// regularized incomplete beta and gamma functions and erfc. Accuracy target: 1e-10 absolute.
import { betaInc, erfc, gammaP, gammaQ, lgamma } from '../../../kits/num/special';
import { ensure } from '../../errors';
import { checkProbability, continuousQuantile } from './quantile';

const positive = (v: number, name: string) => ensure(v > 0 && Number.isFinite(v), 'domain', name);

export const normalPdf = (x: number, mean = 0, sd = 1): number =>
  Math.exp(-0.5 * ((x - mean) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI));
export const normalCdf = (x: number, mean = 0, sd = 1): number => 0.5 * erfc(-(x - mean) / (sd * Math.SQRT2));
export const normalSf = (x: number, mean = 0, sd = 1): number => 0.5 * erfc((x - mean) / (sd * Math.SQRT2));

/** The standard normal quantile: Acklam's rational start, then two Halley steps on erfc (about 1e-15). */
export function normalQuantile(p: number, mean = 0, sd = 1): number {
  checkProbability(p);
  if (p === 0) return -Infinity;
  if (p === 1) return Infinity;
  const q = Math.min(p, 1 - p);
  let x = acklam(q);
  for (let i = 0; i < 2; i += 1) {
    const e = 0.5 * erfc(-x / Math.SQRT2) - q;
    const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
    x -= u / (1 + (x * u) / 2);
  }
  return mean + sd * (p > 0.5 ? -x : x);
}

/** Acklam's approximation of the lower-tail normal quantile for 0 < q ≤ 0.5 (relative error about 1e-9). */
function acklam(q: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  if (q < 0.02425) {
    const r = Math.sqrt(-2 * Math.log(q));
    const num = ((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + 2.938163982698783;
    return num / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1);
  }
  const s = q - 0.5;
  const r = s * s;
  const num = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + 2.506628277459239) * s;
  return num / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export function tPdf(t: number, df: number): number {
  positive(df, 'df');
  const ln = lgamma((df + 1) / 2) - lgamma(df / 2) - 0.5 * Math.log(df * Math.PI);
  return Math.exp(ln - ((df + 1) / 2) * Math.log1p((t * t) / df));
}

/** P(T ≤ t) by the incomplete beta: the two-tail area is I_{df/(df+t²)}(df/2, 1/2). */
export function tCdf(t: number, df: number): number {
  positive(df, 'df');
  if (Number.isNaN(t)) return NaN;
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0;
  const tail = 0.5 * betaInc(df / (df + t * t), df / 2, 0.5);
  return t > 0 ? 1 - tail : tail;
}

export const tSf = (t: number, df: number): number => tCdf(-t, df);

export function tQuantile(p: number, df: number): number {
  positive(df, 'df');
  if (p === 0.5) return 0;
  return continuousQuantile(
    (x) => tCdf(x, df),
    (x) => tSf(x, df),
    p,
    { lo: -Infinity, hi: Infinity },
    normalQuantile(p),
  );
}

export function chiSquarePdf(x: number, df: number): number {
  positive(df, 'df');
  if (x < 0) return 0;
  if (x === 0) return df === 2 ? 0.5 : df < 2 ? Infinity : 0;
  return Math.exp((df / 2 - 1) * Math.log(x) - x / 2 - (df / 2) * Math.LN2 - lgamma(df / 2));
}

export function chiSquareCdf(x: number, df: number): number {
  positive(df, 'df');
  return x <= 0 ? 0 : gammaP(df / 2, x / 2);
}

export function chiSquareSf(x: number, df: number): number {
  positive(df, 'df');
  return x <= 0 ? 1 : gammaQ(df / 2, x / 2);
}

export function chiSquareQuantile(p: number, df: number): number {
  positive(df, 'df');
  const z = normalQuantile(Math.min(Math.max(p, 1e-300), 1 - 1e-16));
  // Wilson-Hilferty start: df (1 - 2/(9 df) + z √(2/(9 df)))³.
  const guess = Math.max(1e-8, df * (1 - 2 / (9 * df) + z * Math.sqrt(2 / (9 * df))) ** 3);
  return continuousQuantile(
    (x) => chiSquareCdf(x, df),
    (x) => chiSquareSf(x, df),
    p,
    { lo: 0, hi: Infinity },
    guess,
  );
}

export function fPdf(x: number, d1: number, d2: number): number {
  positive(d1, 'df1');
  positive(d2, 'df2');
  if (x <= 0) return x === 0 && d1 === 2 ? 1 : 0;
  const ln =
    (d1 / 2) * Math.log(d1 / d2) +
    (d1 / 2 - 1) * Math.log(x) -
    ((d1 + d2) / 2) * Math.log1p((d1 * x) / d2) -
    (lgamma(d1 / 2) + lgamma(d2 / 2) - lgamma((d1 + d2) / 2));
  return Math.exp(ln);
}

export function fCdf(x: number, d1: number, d2: number): number {
  positive(d1, 'df1');
  positive(d2, 'df2');
  return x <= 0 ? 0 : betaInc((d1 * x) / (d1 * x + d2), d1 / 2, d2 / 2);
}

export function fSf(x: number, d1: number, d2: number): number {
  positive(d1, 'df1');
  positive(d2, 'df2');
  return x <= 0 ? 1 : betaInc(d2 / (d2 + d1 * x), d2 / 2, d1 / 2);
}

export function fQuantile(p: number, d1: number, d2: number): number {
  positive(d1, 'df1');
  positive(d2, 'df2');
  const cdf = (x: number) => fCdf(x, d1, d2);
  return continuousQuantile(cdf, (x) => fSf(x, d1, d2), p, { lo: 0, hi: Infinity }, 1);
}

export function betaPdf(x: number, a: number, b: number): number {
  positive(a, 'a');
  positive(b, 'b');
  if (x < 0 || x > 1) return 0;
  const lnB = lgamma(a) + lgamma(b) - lgamma(a + b);
  return Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log1p(-x) - lnB);
}

export function betaCdf(x: number, a: number, b: number): number {
  positive(a, 'a');
  positive(b, 'b');
  return x <= 0 ? 0 : x >= 1 ? 1 : betaInc(x, a, b);
}

export function betaSf(x: number, a: number, b: number): number {
  positive(a, 'a');
  positive(b, 'b');
  return x <= 0 ? 1 : x >= 1 ? 0 : betaInc(1 - x, b, a);
}

export function betaQuantile(p: number, a: number, b: number): number {
  positive(a, 'a');
  positive(b, 'b');
  const cdf = (x: number) => betaCdf(x, a, b);
  return continuousQuantile(cdf, (x) => betaSf(x, a, b), p, { lo: 0, hi: 1 }, a / (a + b));
}

/** Gamma with shape k and scale θ (mean kθ). */
export function gammaPdf(x: number, shape: number, scale = 1): number {
  positive(shape, 'shape');
  positive(scale, 'scale');
  if (x < 0) return 0;
  if (x === 0) return shape === 1 ? 1 / scale : shape < 1 ? Infinity : 0;
  return Math.exp((shape - 1) * Math.log(x / scale) - x / scale - lgamma(shape)) / scale;
}

export function gammaCdf(x: number, shape: number, scale = 1): number {
  positive(shape, 'shape');
  positive(scale, 'scale');
  return x <= 0 ? 0 : gammaP(shape, x / scale);
}

export function gammaSf(x: number, shape: number, scale = 1): number {
  positive(shape, 'shape');
  positive(scale, 'scale');
  return x <= 0 ? 1 : gammaQ(shape, x / scale);
}

export function gammaQuantile(p: number, shape: number, scale = 1): number {
  return scale * chiSquareQuantile(p, 2 * shape) * 0.5;
}

export function exponentialCdf(x: number, rate = 1): number {
  positive(rate, 'rate');
  return x <= 0 ? 0 : -Math.expm1(-rate * x);
}

export function exponentialSf(x: number, rate = 1): number {
  positive(rate, 'rate');
  return x <= 0 ? 1 : Math.exp(-rate * x);
}

export function exponentialQuantile(p: number, rate = 1): number {
  positive(rate, 'rate');
  checkProbability(p);
  return -Math.log1p(-p) / rate;
}
