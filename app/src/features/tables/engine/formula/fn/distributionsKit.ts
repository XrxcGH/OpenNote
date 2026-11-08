// The probability distributions behind the statistical functions. Owner: tables:fn-stats. Lazy chunk only.
// Written from the textbook definitions (NIST/SEMATECH e-Handbook and Abramowitz and Stegun) on top of
// core/num/special: the normal law from erfc, the gamma family from the regularized incomplete gamma, and the
// beta, Student t, and F laws from the regularized incomplete beta. Inverses solve the distribution numerically.

import { betaInc, erfc, gammaP, gammaQ, lgamma } from '../../../../../core/num/special';

const SQRT2 = Math.SQRT2;
const LN_SQRT_2PI = 0.5 * Math.log(2 * Math.PI);

// Normal.

export const normPdf = (z: number): number => Math.exp(-0.5 * z * z - LN_SQRT_2PI);

/** The standard normal distribution, from erfc so the tails keep their digits. */
export const normCdf = (z: number): number => 0.5 * erfc(-z / SQRT2);

// A rational starting point for the inverse normal, from the published coefficients of P. J. Acklam's algorithm,
// then refined by Halley steps on normCdf, so the result is as accurate as normCdf itself.
const A = [
  -39.69683028665376, 220.9460984245205, -275.928510446969, 138.357751867269, -30.66479806614716, 2.506628277459239,
];
const B = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
const C = [
  -0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968,
  2.938163982698783,
];
const D = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
const P_LOW = 0.02425;

function poly(c: readonly number[], x: number): number {
  let s = 0;
  for (const k of c) s = s * x + k;
  return s;
}

function normGuess(p: number): number {
  if (p < P_LOW) {
    const q = Math.sqrt(-2 * Math.log(p));
    return poly(C, q) / (poly(D, q) * q + 1);
  }
  if (p > 1 - P_LOW) {
    const q = Math.sqrt(-2 * Math.log1p(-p));
    return -poly(C, q) / (poly(D, q) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (poly(A, r) * q) / (poly(B, r) * r + 1);
}

/** The inverse of the standard normal distribution for 0 < p < 1. */
export function normInv(p: number): number {
  if (!(p > 0 && p < 1)) return NaN;
  let x = normGuess(p);
  for (let i = 0; i < 3; i++) {
    // The residual cdf(x) - p, worked in the smaller tail so it keeps its digits; then one Halley step.
    const e = p < 0.5 ? normCdf(x) - p : 1 - p - normCdf(-x);
    const u = e / normPdf(x);
    const step = u / (1 + (x * u) / 2);
    x -= step;
    if (Math.abs(step) <= 1e-16 * Math.max(1, Math.abs(x))) break;
  }
  return x;
}

// Gamma and chi-squared.

export function gammaPdf(x: number, a: number, b: number): number {
  if (x < 0) return 0;
  if (x === 0) return a === 1 ? 1 / b : a < 1 ? Infinity : 0;
  return Math.exp((a - 1) * Math.log(x) - x / b - a * Math.log(b) - lgamma(a));
}

export const gammaCdf = (x: number, a: number, b: number): number => (x <= 0 ? 0 : gammaP(a, x / b));
export const gammaSf = (x: number, a: number, b: number): number => (x <= 0 ? 1 : gammaQ(a, x / b));

// Beta.

export function betaPdf(x: number, a: number, b: number): number {
  if (x < 0 || x > 1) return 0;
  if (x === 0) return a === 1 ? b : a < 1 ? Infinity : 0;
  if (x === 1) return b === 1 ? a : b < 1 ? Infinity : 0;
  return Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log1p(-x) - (lgamma(a) + lgamma(b) - lgamma(a + b)));
}

// Student t.

/** The upper tail P(T > t) for t >= 0. */
function tUpper(t: number, df: number): number {
  return 0.5 * betaInc(df / (df + t * t), df / 2, 0.5);
}

export const tCdf = (t: number, df: number): number => (t >= 0 ? 1 - tUpper(t, df) : tUpper(-t, df));
export const tSf = (t: number, df: number): number => (t >= 0 ? tUpper(t, df) : 1 - tUpper(-t, df));

export function tPdf(t: number, df: number): number {
  const lnc = lgamma((df + 1) / 2) - lgamma(df / 2) - 0.5 * Math.log(df * Math.PI);
  return Math.exp(lnc - ((df + 1) / 2) * Math.log1p((t * t) / df));
}

// F.

export function fCdf(x: number, d1: number, d2: number): number {
  return x <= 0 ? 0 : betaInc((d1 * x) / (d1 * x + d2), d1 / 2, d2 / 2);
}

export function fSf(x: number, d1: number, d2: number): number {
  return x <= 0 ? 1 : betaInc(d2 / (d2 + d1 * x), d2 / 2, d1 / 2);
}

export function fPdf(x: number, d1: number, d2: number): number {
  if (x < 0) return 0;
  if (x === 0) return d1 === 2 ? 1 : d1 < 2 ? Infinity : 0;
  const lnB = lgamma(d1 / 2) + lgamma(d2 / 2) - lgamma((d1 + d2) / 2);
  const ln =
    (d1 / 2) * Math.log(d1 / d2) + (d1 / 2 - 1) * Math.log(x) - ((d1 + d2) / 2) * Math.log1p((d1 * x) / d2) - lnB;
  return Math.exp(ln);
}

// Discrete laws.

/** ln C(n, k) for whole numbers. */
export const lnChoose = (n: number, k: number): number => lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);

/** C(n, k), exact while the product stays within the digits of a double. */
export function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  const j = Math.min(k, n - k);
  let c = 1;
  for (let i = 1; i <= j; i++) {
    c = (c * (n - j + i)) / i;
    if (!Number.isFinite(c)) return Math.exp(lnChoose(n, k));
  }
  return Math.round(c) === c || c > 2 ** 53 ? c : Math.round(c);
}

export function binomPmf(k: number, n: number, p: number): number {
  if (k < 0 || k > n) return 0;
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;
  const c = choose(n, k);
  if (Number.isFinite(c) && c < 2 ** 53) {
    const v = c * p ** k * (1 - p) ** (n - k);
    if (v > 1e-280) return v;
  }
  return Math.exp(lnChoose(n, k) + k * Math.log(p) + (n - k) * Math.log1p(-p));
}

/** P(X <= k) for a binomial law. Small n adds the terms; large n uses the incomplete beta. */
export function binomCdf(k: number, n: number, p: number): number {
  if (k < 0) return 0;
  if (k >= n) return 1;
  if (n <= 1000) {
    let s = 0;
    for (let i = 0; i <= k; i++) s += binomPmf(i, n, p);
    return Math.min(1, s);
  }
  return betaInc(1 - p, n - k, k + 1);
}

export function poissonPmf(k: number, m: number): number {
  if (m === 0) return k === 0 ? 1 : 0;
  if (k <= 100) {
    let v = Math.exp(-m);
    for (let i = 1; i <= k; i++) v *= m / i;
    if (v > 1e-280) return v;
  }
  return Math.exp(k * Math.log(m) - m - lgamma(k + 1));
}

export const poissonCdf = (k: number, m: number): number => (m === 0 ? 1 : gammaQ(k + 1, m));

// Inverses.

/**
 * Solves cdf(x) = p for an increasing cdf on (lo, hi), widening `hi` while it is finite and too small. Bisection,
 * which needs no derivative and always lands within the digits of a double.
 */
export function invert(cdf: (x: number) => number, p: number, lo: number, hi: number): number {
  let a = lo;
  let b = hi;
  while (cdf(b) < p && b < 1e300) {
    a = b;
    b *= 2;
  }
  for (let i = 0; i < 2000; i++) {
    const m = a + (b - a) / 2;
    if (m === a || m === b) break;
    if (cdf(m) < p) a = m;
    else b = m;
  }
  return a + (b - a) / 2;
}

/** Solves sf(x) = q for a decreasing survival function, for upper-tail inverses with tiny q. */
export function invertUpper(sf: (x: number) => number, q: number, lo: number, hi: number): number {
  return invert((x) => -sf(x), -q, lo, hi);
}
