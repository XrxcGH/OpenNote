// Special functions for the probability tools. Erfc, log gamma, the regularized incomplete beta, and the normal,
// Student t, and binomial distributions are ported from the math solvers, so the kit keeps within its own feature;
// they are written out to about 1e-14. Added here: the regularized incomplete gamma function (series and continued
// fraction, after Abramowitz and Stegun 6.5), the gamma function, log binomial coefficients, and a generic inverse
// of a cumulative distribution.
import { brent } from './num';

/** erfc by its Taylor series near 0 and a continued fraction beyond. */
export function erfc(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (Math.abs(x) < 2.5) {
    let term = x;
    let sum = x;
    for (let n = 1; n < 200; n += 1) {
      term *= (-x * x) / n;
      const add = term / (2 * n + 1);
      sum += add;
      if (Math.abs(add) < 1e-17 * Math.abs(sum)) break;
    }
    return 1 - (2 / Math.sqrt(Math.PI)) * sum;
  }
  if (x < 0) return 2 - erfc(-x);
  // erfc x = e^(-x²)/√π · 1/(x + (1/2)/(x + 1/(x + (3/2)/(x + …)))), evaluated from the tail.
  let f = x;
  for (let n = 80; n >= 1; n -= 1) f = x + n / 2 / f;
  return Math.exp(-x * x) / Math.sqrt(Math.PI) / f;
}

export const erf = (x: number): number => 1 - erfc(x);

/** ln Γ(x) for x > 0, by the Lanczos approximation (g = 7). */
export function lnGamma(x: number): number {
  const c = [
    0.9999999999998099, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 0.000009984369578019572, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lnGamma(1 - x);
  const z = x - 1;
  let a = c[0];
  const t = z + 7.5;
  for (let i = 1; i < 9; i += 1) a += c[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** The regularized incomplete beta I_x(a, b), by the continued fraction of Numerical Recipes. */
export function betaInc(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x > (a + 1) / (a + b + 2)) return 1 - betaInc(1 - x, b, a);
  const tiny = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  d = 1 / (Math.abs(d) < tiny ? tiny : d);
  let h = d;
  for (let m = 1; m <= 300; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    d = 1 / (Math.abs(d) < tiny ? tiny : d);
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    d = 1 / (Math.abs(d) < tiny ? tiny : d);
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return (front * h) / a;
}

export const normalPdf = (x: number, mean = 0, sd = 1): number =>
  Math.exp(-0.5 * ((x - mean) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI));
export const normalCdf = (x: number, mean = 0, sd = 1): number => 0.5 * erfc(-(x - mean) / (sd * Math.SQRT2));

export function tPdf(t: number, df: number): number {
  const ln =
    lnGamma((df + 1) / 2) -
    lnGamma(df / 2) -
    0.5 * Math.log(df * Math.PI) -
    ((df + 1) / 2) * Math.log(1 + (t * t) / df);
  return Math.exp(ln);
}

export function tCdf(t: number, df: number): number {
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0;
  const tail = 0.5 * betaInc(df / (df + t * t), df / 2, 0.5);
  return t > 0 ? 1 - tail : tail;
}

export function binomialPmf(k: number, n: number, p: number): number {
  if (k < 0 || k > n || !Number.isInteger(k)) return 0;
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;
  return Math.exp(lnGamma(n + 1) - lnGamma(k + 1) - lnGamma(n - k + 1) + k * Math.log(p) + (n - k) * Math.log(1 - p));
}

export function binomialCdf(k: number, n: number, p: number): number {
  let sum = 0;
  for (let i = 0; i <= Math.min(n, Math.floor(k)); i += 1) sum += binomialPmf(i, n, p);
  return Math.min(1, sum);
}

/** The standard normal quantile, by Acklam's rational approximation and one Halley step. */
export function normalQuantile(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239,
  ];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968,
    2.938163982698783,
  ];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  let x: number;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    x =
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - low) {
    const q = p - 0.5;
    const r = q * q;
    x =
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x =
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const e = normalCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

/** The t quantile, by Newton's method from the normal one. */
export function tQuantile(p: number, df: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  let x = normalQuantile(p);
  for (let i = 0; i < 60; i += 1) {
    const step = (tCdf(x, df) - p) / tPdf(x, df);
    x -= Math.max(-2, Math.min(2, step));
    if (Math.abs(step) < 1e-14 * Math.max(1, Math.abs(x))) break;
  }
  return x;
}

/** Γ(x) for real x (not a non-positive integer). */
export function gammaFn(x: number): number {
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gammaFn(1 - x));
  if (Number.isInteger(x) && x <= 171) {
    let f = 1;
    for (let k = 2; k < x; k += 1) f *= k;
    return f;
  }
  return Math.exp(lnGamma(x));
}

/** The regularized lower incomplete gamma P(a, x) = γ(a, x)/Γ(a). */
export function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (!Number.isFinite(x)) return 1;
  if (x < a + 1) {
    // Series: P = e^{−x} x^a Σ x^n / Γ(a + n + 1)
    let term = 1 / a;
    let sum = term;
    for (let n = 1; n < 1000; n += 1) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-17) break;
    }
    return Math.min(1, sum * Math.exp(-x + a * Math.log(x) - lnGamma(a)));
  }
  return 1 - gammaQ(a, x);
}

/** The regularized upper incomplete gamma Q(a, x) = 1 − P(a, x). */
export function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (!Number.isFinite(x)) return 0;
  if (x < a + 1) return 1 - gammaP(a, x);
  // Continued fraction by the modified Lentz method.
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

/** ln C(n, k). */
export const lnChoose = (n: number, k: number): number => lnGamma(n + 1) - lnGamma(k + 1) - lnGamma(n - k + 1);

/**
 * The x with cdf(x) = p for a continuous, increasing cdf: brackets outward from a starting guess, then Brent.
 * lo and hi bound the support.
 */
export function invertCdf(cdf: (x: number) => number, p: number, guess: number, lo = -Infinity, hi = Infinity): number {
  if (p <= 0) return lo;
  if (p >= 1) return hi;
  const f = (x: number) => cdf(x) - p;
  let a = Number.isFinite(lo) ? lo : guess - 1;
  let b = Number.isFinite(hi) ? hi : guess + 1;
  if (Number.isFinite(lo) && Number.isFinite(hi)) return brent(f, a, b, 1e-15);
  // Grow an infinite side until it brackets the root.
  let width = Math.max(1, Math.abs(guess));
  for (let i = 0; i < 400 && f(a) > 0; i += 1) {
    width *= 2;
    a = Number.isFinite(lo) ? lo : guess - width;
  }
  width = Math.max(1, Math.abs(guess));
  for (let i = 0; i < 400 && f(b) < 0; i += 1) {
    width *= 2;
    b = Number.isFinite(hi) ? hi : guess + width;
  }
  return brent(f, a, b, 1e-15 * Math.max(1, Math.abs(guess)));
}

export const chi2Cdf = (x: number, k: number): number => gammaP(k / 2, x / 2);
export const fCdf = (x: number, d1: number, d2: number): number =>
  x <= 0 ? 0 : betaInc((d1 * x) / (d1 * x + d2), d1 / 2, d2 / 2);

/** The chi-square quantile. */
export function chi2Quantile(p: number, k: number): number {
  // Wilson–Hilferty start.
  const z = normalQuantile(p);
  const h = 2 / (9 * k);
  const guess = Math.max(1e-8, k * (1 - h + z * Math.sqrt(h)) ** 3);
  return invertCdf((x) => chi2Cdf(x, k), p, guess, 0, Infinity);
}
