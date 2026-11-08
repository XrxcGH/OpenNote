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

/** At or above this parameter the incomplete beta takes the wide path below. */
const WIDE = 1e5;

/** ln(1 + u) - u, accurate for small u. */
function log1pmx(u: number): number {
  if (Math.abs(u) > 0.1) return Math.log1p(u) - u;
  let power = u;
  let sum = 0;
  for (let k = 2; k < 80; k++) {
    power *= -u;
    const term = power / k;
    sum += term;
    if (Math.abs(term) <= 1e-17 * Math.abs(sum)) break;
  }
  return sum;
}

/** ln Gamma(x) less its Stirling form (x - 1/2) ln x - x + ln(2 pi) / 2: the Bernoulli series (DLMF 5.11.1) from 30. */
function stirlingRest(x: number): number {
  if (x < 30) return lgamma(x) - ((x - 0.5) * Math.log(x) - x + LN_SQRT_2PI);
  const r = 1 / (x * x);
  return (1 / 12 - r * (1 / 360 - r * (1 / 1260 - r / 1680))) / x;
}

/**
 * The power term x^a y^b / B(a, b), with y = 1 - x, kept exact for large parameters. The caller passes y when it
 * knows 1 - x exactly. Near the mean x0 = a / (a + b), the logs of the power and of B(a, b) each reach about a + b.
 * Their difference has no such size. It is ln(a b / (a + b)) / 2 - ln(2 pi) / 2, less the Stirling rests, plus
 * a (ln(1 + u) - u) + b (ln(1 + v) - v). Here u = x / x0 - 1 and v = y / (1 - x0) - 1, so a u + b v = 0.
 */
export function betaPower(x: number, a: number, b: number, y = 1 - x): number {
  const s = a + b;
  const u = (x * s - a) / a;
  const v = (y * s - b) / b;
  const ln =
    0.5 * Math.log((a / s) * b) -
    LN_SQRT_2PI -
    stirlingRest(a) -
    stirlingRest(b) +
    stirlingRest(s) +
    a * log1pmx(u) +
    b * log1pmx(v);
  return Math.exp(ln);
}

/** The continued fraction of I_x(a, b) (DLMF 8.17.22) by Lentz's method, with the exact power term above. */
function betaIncFraction(x: number, a: number, b: number, y: number): number {
  if (x <= 0) return 0;
  if (y <= 0) return 1;
  if (x > (a + 1) / (a + b + 2)) return 1 - betaIncFraction(y, b, a, x);
  const tiny = 1e-300;
  let f = 1;
  let c = 1;
  let d = 0;
  // Near the mean the fraction needs about the square root of the larger parameter in terms.
  for (let i = 0; i <= 4_000_000; i++) {
    const m = Math.floor(i / 2);
    let num: number;
    if (i === 0) num = 1;
    else if (i % 2 === 0) num = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    else num = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + num * d;
    d = 1 / (Math.abs(d) < tiny ? tiny : d);
    c = 1 + num / c;
    if (Math.abs(c) < tiny) c = tiny;
    const delta = c * d;
    f *= delta;
    if (Math.abs(delta - 1) < 2 ** -52) return (betaPower(x, a, b, y) / a) * (f - 1);
  }
  return NaN;
}

/**
 * The regularized incomplete beta I_x(a, b), with y = 1 - x passed when the caller knows it exactly. The core
 * routine serves parameters below WIDE. Larger ones, such as the F law at a million degrees of freedom or the
 * binomial law at a billion trials, run out of its terms and lose digits in ln B(a, b), so they take the longer
 * fraction with the exact power term.
 */
export const betaIncWide = (x: number, a: number, b: number, y = 1 - x): number =>
  Math.max(a, b) >= WIDE ? betaIncFraction(x, a, b, y) : betaInc(x, a, b);

export function betaPdf(x: number, a: number, b: number): number {
  if (x < 0 || x > 1) return 0;
  if (x === 0) return a === 1 ? b : a < 1 ? Infinity : 0;
  if (x === 1) return b === 1 ? a : b < 1 ? Infinity : 0;
  return Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log1p(-x) - (lgamma(a) + lgamma(b) - lgamma(a + b)));
}

// Student t.

/**
 * Past this many degrees of freedom the fraction in x = df / (df + t^2) loses digits, since x carries 1 - x with
 * only about 16 - log10(df) of them, so the t law is the normal law with two terms of its expansion in 1 / df.
 */
const T_NORMAL = 1e7;

/**
 * The upper tail P(T > t) for t >= 0: I_x(df / 2, 1 / 2) / 2 with x = df / (df + t^2). Many degrees of freedom
 * take the wide path with 1 - x = t^2 / (df + t^2) worked out exactly, since 1 - x rounded would lose its digits.
 */
function tUpper(t: number, df: number): number {
  if (df > T_NORMAL) {
    // Abramowitz and Stegun 26.7.5: Phi(-t) + phi(t) (g1 / df + g2 / df^2), with the next term near 1E-21 here.
    const t2 = t * t;
    const g1 = (t2 * t + t) / 4;
    const g2 = (t * (((3 * t2 - 7) * t2 - 5) * t2 - 3)) / 96;
    return normCdf(-t) + normPdf(t) * (g1 / df + g2 / (df * df));
  }
  const [x, y] = [df / (df + t * t), (t * t) / (df + t * t)];
  return 0.5 * (df >= 2 * WIDE ? betaIncWide(x, df / 2, 0.5, y) : betaInc(x, df / 2, 0.5));
}

export const tCdf = (t: number, df: number): number => (t >= 0 ? 1 - tUpper(t, df) : tUpper(-t, df));
export const tSf = (t: number, df: number): number => (t >= 0 ? tUpper(t, df) : 1 - tUpper(-t, df));

export function tPdf(t: number, df: number): number {
  // ln Gamma((df + 1) / 2) - ln Gamma(df / 2) - ln(df pi) / 2. For many degrees of freedom the two ln Gamma values
  // nearly cancel, so with a = df / 2 it is a ln(1 + 1 / (2 a)) - 1/2 - ln(2 pi) / 2 plus the Stirling rests.
  const a = df / 2;
  const lnc =
    df >= 2 * WIDE
      ? a * Math.log1p(0.5 / a) - 0.5 - LN_SQRT_2PI + stirlingRest(a + 0.5) - stirlingRest(a)
      : lgamma((df + 1) / 2) - lgamma(df / 2) - 0.5 * Math.log(df * Math.PI);
  return Math.exp(lnc - ((df + 1) / 2) * Math.log1p((t * t) / df));
}

// F.

export function fCdf(x: number, d1: number, d2: number): number {
  return x <= 0 ? 0 : betaIncWide((d1 * x) / (d1 * x + d2), d1 / 2, d2 / 2, d2 / (d1 * x + d2));
}

export function fSf(x: number, d1: number, d2: number): number {
  return x <= 0 ? 1 : betaIncWide(d2 / (d2 + d1 * x), d2 / 2, d1 / 2, (d1 * x) / (d2 + d1 * x));
}

export function fPdf(x: number, d1: number, d2: number): number {
  if (x < 0) return 0;
  if (x === 0) return d1 === 2 ? 1 : d1 < 2 ? Infinity : 0;
  // The density is the beta density of y = d1 x / (d1 x + d2) times dy/dx, which comes to betaPower(y) / x.
  if (Math.max(d1, d2) >= 2 * WIDE) {
    return betaPower((d1 * x) / (d1 * x + d2), d1 / 2, d2 / 2, d2 / (d1 * x + d2)) / x;
  }
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
  return betaIncWide(1 - p, n - k, k + 1, p);
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

/**
 * P(X <= k) for a hypergeometric law with many terms. The terms fall away from the mode on each side. So the sum
 * starts at k and runs away from the mode, by the ratio of neighboring terms, until the terms no longer count. Below
 * the mode that is the lower tail; at or past it, the result is one less the upper tail past k. The work grows with
 * the spread, not the population.
 */
export function hypgeomTail(k: number, draws: number, succ: number, pop: number): number {
  const lnPmf = (i: number) => lnChoose(succ, i) + lnChoose(pop - succ, draws - i) - lnChoose(pop, draws);
  const low = Math.max(0, draws - pop + succ);
  const high = Math.min(draws, succ);
  const mode = Math.floor(((draws + 1) * (succ + 1)) / (pop + 2));
  // up(i) = pmf(i + 1) / pmf(i).
  const up = (i: number) => ((succ - i) * (draws - i)) / ((i + 1) * (pop - succ - draws + i + 1));
  let total = 0;
  if (k < mode) {
    let term = Math.exp(lnPmf(k));
    for (let i = k; i >= low && term > 1e-17 * total; i--) {
      total += term;
      term /= up(i - 1);
    }
    return Math.min(1, total);
  }
  if (k >= high) return 1;
  let term = Math.exp(lnPmf(k + 1));
  for (let i = k + 1; i <= high && term > 1e-17 * total; i++) {
    total += term;
    term *= up(i);
  }
  return Math.max(0, 1 - total);
}

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
