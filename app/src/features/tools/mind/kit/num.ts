// The numerical routines the psychology tools share: the normal, t, and F distributions, the log-gamma and
// incomplete beta functions under them, root finding, integration, minimizing, and straight-line fits. Every
// routine works on numbers alone and is checked against published values in num.test.ts.

const SQRT_PI = Math.sqrt(Math.PI);
const LOG_SQRT_2PI = 0.5 * Math.log(2 * Math.PI);

/** The continued fraction under erfc for x of 2.5 or more, worked from its far end. */
function erfcFraction(x: number): number {
  let tail = x;
  for (let n = 120; n >= 1; n -= 1) tail = x + n / 2 / tail;
  return tail;
}

/** The error function. Below 2.5 its series has only positive terms, so it loses nothing to cancellation. */
export function erf(x: number): number {
  if (x < 0) return -erf(-x);
  if (x >= 2.5) return 1 - erfc(x);
  const x2 = 2 * x * x;
  let term = x;
  let sum = x;
  for (let n = 1; n < 300; n += 1) {
    term *= x2 / (2 * n + 1);
    sum += term;
    if (term < sum * 1e-17) break;
  }
  return (2 / SQRT_PI) * Math.exp(-x * x) * sum;
}

/** The complementary error function, accurate in its far tail too. */
export function erfc(x: number): number {
  if (x < 0) return 2 - erfc(-x);
  if (x < 2.5) return 1 - erf(x);
  return Math.exp(-x * x) / SQRT_PI / erfcFraction(x);
}

/** The standard normal density. */
export const normPdf = (z: number): number => Math.exp(-0.5 * z * z - LOG_SQRT_2PI);

/** The standard normal distribution function, Phi. */
export function normCdf(z: number): number {
  if (Number.isNaN(z)) return NaN;
  const tail = 0.5 * erfc(Math.abs(z) / Math.SQRT2);
  return z < 0 ? tail : 1 - tail;
}

/** The logarithm of Phi, which stays finite far into the lower tail. */
export function logNormCdf(z: number): number {
  if (z > -5) return Math.log(normCdf(z));
  const x = -z / Math.SQRT2;
  return Math.log(0.5) - x * x - Math.log(SQRT_PI) - Math.log(erfcFraction(x));
}

// Acklam's rational approximation, a start that two Halley steps on Phi make exact to rounding.
const A = [
  -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239,
];
const B = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
const C = [
  -0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968,
  2.938163982698783,
];
const D = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];

function acklam(p: number): number {
  const low = 0.02425;
  if (p < low || p > 1 - low) {
    const q = Math.sqrt(-2 * Math.log(p < low ? p : 1 - p));
    const x =
      (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) /
      ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1);
    return p < low ? x : -x;
  }
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q) /
    (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1)
  );
}

/** The standard normal quantile, z(p). It is minus and plus infinity at 0 and 1, and NaN outside them. */
export function normQuantile(p: number): number {
  if (!(p >= 0 && p <= 1)) return NaN;
  if (p === 0) return -Infinity;
  if (p === 1) return Infinity;
  let x = acklam(p);
  for (let i = 0; i < 2; i += 1) {
    const e = normCdf(x) - p;
    const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
    x -= u / (1 + (x * u) / 2);
  }
  return x;
}

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** The logarithm of the gamma function (Lanczos, g = 7). */
export function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - logGamma(1 - x);
  const y = x - 1;
  let sum = LANCZOS[0];
  for (let i = 1; i < 9; i += 1) sum += LANCZOS[i] / (y + i);
  const t = y + 7.5;
  return LOG_SQRT_2PI + (y + 0.5) * Math.log(t) - t + Math.log(sum);
}

/** The continued fraction of the incomplete beta function, by the modified Lentz method. */
function betaFraction(a: number, b: number, x: number): number {
  const tiny = 1e-300;
  const clamp = (v: number) => (Math.abs(v) < tiny ? tiny : v);
  let c = 1;
  let d = 1 / clamp(1 - ((a + b) * x) / (a + 1));
  let h = d;
  for (let m = 1; m <= 400; m += 1) {
    const m2 = 2 * m;
    const even = (m * (b - m) * x) / ((a - 1 + m2) * (a + m2));
    d = 1 / clamp(1 + even * d);
    c = clamp(1 + even / c);
    h *= d * c;
    const odd = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + 1 + m2));
    d = 1 / clamp(1 + odd * d);
    c = clamp(1 + odd / c);
    const step = d * c;
    h *= step;
    if (Math.abs(step - 1) < 1e-16) break;
  }
  return h;
}

/** The regularized incomplete beta function I_x(a, b). */
export function betaInc(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (front * betaFraction(a, b, x)) / a : 1 - (front * betaFraction(b, a, 1 - x)) / b;
}

/** Student's t distribution function. */
export function tCdf(t: number, df: number): number {
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0;
  const tail = 0.5 * betaInc(df / 2, 0.5, df / (df + t * t));
  return t > 0 ? 1 - tail : tail;
}

/** The F distribution function. */
export function fCdf(x: number, d1: number, d2: number): number {
  if (x <= 0) return 0;
  return betaInc(d1 / 2, d2 / 2, (d1 * x) / (d1 * x + d2));
}

/** The x where an increasing function reaches p, found by widening a bracket and halving it. */
function invert(cdf: (x: number) => number, p: number, lo: number, hi: number): number {
  let low = lo;
  let high = hi;
  while (cdf(high) < p && high < 1e12) high *= 2;
  while (cdf(low) > p && low > -1e12) low = low < 0 ? low * 2 : low - 1;
  for (let i = 0; i < 200 && high - low > 1e-14 * Math.max(1, Math.abs(high)); i += 1) {
    const mid = (low + high) / 2;
    if (cdf(mid) < p) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/** The t quantile with df degrees of freedom. */
export function tQuantile(p: number, df: number): number {
  if (!(p > 0 && p < 1) || !(df > 0)) return NaN;
  return invert((x) => tCdf(x, df), p, -10, 10);
}

/** The F quantile with d1 and d2 degrees of freedom. */
export function fQuantile(p: number, d1: number, d2: number): number {
  if (!(p > 0 && p < 1) || !(d1 > 0) || !(d2 > 0)) return NaN;
  return invert((x) => fCdf(x, d1, d2), p, 0, 10);
}

/** A root of f between lo and hi, where f changes sign, by Brent's method; NaN when it does not change sign. */
export function brent(f: (x: number) => number, lo: number, hi: number, tol = 1e-13): number {
  let a = lo;
  let b = hi;
  let fa = f(a);
  let fb = f(b);
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (fa * fb > 0 || !Number.isFinite(fa) || !Number.isFinite(fb)) return NaN;
  let c = a;
  let fc = fa;
  let d = b - a;
  let e = d;
  for (let i = 0; i < 300; i += 1) {
    if (fb * fc > 0) {
      c = a;
      fc = fa;
      d = b - a;
      e = d;
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      [a, b, c] = [b, c, b];
      [fa, fb, fc] = [fb, fc, fb];
    }
    const tol1 = 2 * Number.EPSILON * Math.abs(b) + tol / 2;
    const m = (c - b) / 2;
    if (Math.abs(m) <= tol1 || fb === 0) return b;
    if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa;
      let p: number;
      let q: number;
      if (a === c) {
        p = 2 * m * s;
        q = 1 - s;
      } else {
        const qa = fa / fc;
        const r = fb / fc;
        p = s * (2 * m * qa * (qa - r) - (b - a) * (r - 1));
        q = (qa - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q;
      else p = -p;
      if (2 * p < Math.min(3 * m * q - Math.abs(tol1 * q), Math.abs(e * q))) {
        e = d;
        d = p / q;
      } else {
        d = m;
        e = m;
      }
    } else {
      d = m;
      e = m;
    }
    a = b;
    fa = fb;
    b += Math.abs(d) > tol1 ? d : m > 0 ? tol1 : -tol1;
    fb = f(b);
  }
  return b;
}

/** The integral of f from a to b by adaptive Simpson's rule. */
export function integrate(f: (x: number) => number, a: number, b: number, eps = 1e-12): number {
  const simpson = (l: number, r: number, fl: number, fm: number, fr: number) => ((r - l) / 6) * (fl + 4 * fm + fr);
  const step = (
    l: number,
    r: number,
    fl: number,
    fm: number,
    fr: number,
    whole: number,
    tol: number,
    depth: number,
  ): number => {
    const m = (l + r) / 2;
    const lm = (l + m) / 2;
    const rm = (m + r) / 2;
    const flm = f(lm);
    const frm = f(rm);
    const left = simpson(l, m, fl, flm, fm);
    const right = simpson(m, r, fm, frm, fr);
    if (depth <= 0 || Math.abs(left + right - whole) <= 15 * tol) return left + right + (left + right - whole) / 15;
    return step(l, m, fl, flm, fm, left, tol / 2, depth - 1) + step(m, r, fm, frm, fr, right, tol / 2, depth - 1);
  };
  const fa = f(a);
  const fb = f(b);
  const fm = f((a + b) / 2);
  return step(a, b, fa, fm, fb, simpson(a, b, fa, fm, fb), eps, 40);
}

/** The x in [lo, hi] where f is least, by golden-section search. */
export function minimize1d(f: (x: number) => number, lo: number, hi: number, tol = 1e-12): number {
  const g = (Math.sqrt(5) - 1) / 2;
  let a = lo;
  let b = hi;
  let c = b - g * (b - a);
  let d = a + g * (b - a);
  let fc = f(c);
  let fd = f(d);
  for (let i = 0; i < 400 && Math.abs(b - a) > tol * Math.max(1, Math.abs(a) + Math.abs(b)); i += 1) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - g * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + g * (b - a);
      fd = f(d);
    }
  }
  return (a + b) / 2;
}

export interface Minimum {
  readonly x: number[];
  readonly value: number;
}

/** The point where f is least, by the Nelder-Mead simplex, restarted from its own answer until it settles. */
export function nelderMead(f: (x: number[]) => number, start: readonly number[], scale: readonly number[]): Minimum {
  let best = simplex(f, [...start], scale);
  for (let restart = 0; restart < 4; restart += 1) {
    const next = simplex(
      f,
      best.x,
      scale.map((s) => s / 10),
    );
    const settled = Math.abs(next.value - best.value) <= 1e-12 * (1 + Math.abs(best.value));
    if (next.value <= best.value) best = next;
    if (settled) break;
  }
  return best;
}

function simplex(f: (x: number[]) => number, start: number[], scale: readonly number[]): Minimum {
  const n = start.length;
  const value = (x: number[]) => {
    const v = f(x);
    return Number.isFinite(v) ? v : Infinity;
  };
  let points = [start, ...start.map((_, i) => start.map((v, j) => (i === j ? v + scale[i] : v)))];
  let values = points.map(value);
  for (let iter = 0; iter < 4000 * n; iter += 1) {
    const order = values.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
    points = order.map(([, i]) => points[i]);
    values = order.map(([v]) => v);
    const spread = Math.abs(values[n] - values[0]);
    if (spread <= 1e-14 * (Math.abs(values[0]) + 1e-14) && iter > 10) break;
    const centre = start.map((_, j) => points.slice(0, n).reduce((s, p) => s + p[j], 0) / n);
    const along = (t: number) => centre.map((c, j) => c + t * (points[n][j] - c));
    const reflected = along(-1);
    const fr = value(reflected);
    if (fr < values[0]) {
      const expanded = along(-2);
      const fe = value(expanded);
      [points[n], values[n]] = fe < fr ? [expanded, fe] : [reflected, fr];
    } else if (fr < values[n - 1]) {
      [points[n], values[n]] = [reflected, fr];
    } else {
      const contracted = fr < values[n] ? along(-0.5) : along(0.5);
      const fcon = value(contracted);
      if (fcon < Math.min(fr, values[n])) [points[n], values[n]] = [contracted, fcon];
      else {
        points = points.map((p, i) => (i === 0 ? p : p.map((v, j) => points[0][j] + 0.5 * (v - points[0][j]))));
        values = points.map((p, i) => (i === 0 ? values[0] : value(p)));
      }
    }
  }
  const at = values.indexOf(Math.min(...values));
  return { x: points[at], value: values[at] };
}

export interface LineFit {
  readonly intercept: number;
  readonly slope: number;
  readonly r2: number;
  readonly n: number;
}

/** The least-squares line y = intercept + slope x. */
export function lineFit(xs: readonly number[], ys: readonly number[]): LineFit {
  const n = xs.length;
  const mx = mean(xs);
  const my = mean(ys);
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
    syy += (ys[i] - my) ** 2;
  }
  const slope = sxy / sxx;
  return { intercept: my - slope * mx, slope, r2: syy === 0 ? 1 : (sxy * sxy) / (sxx * syy), n };
}

export const sum = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0);
export const mean = (xs: readonly number[]): number => sum(xs) / xs.length;

/** The variance with n - 1 below (sample) or n below (population). */
export function variance(xs: readonly number[], population = false): number {
  const m = mean(xs);
  return sum(xs.map((x) => (x - m) ** 2)) / (xs.length - (population ? 0 : 1));
}

export const sd = (xs: readonly number[], population = false): number => Math.sqrt(variance(xs, population));

/** The quantile at p by linear interpolation between order statistics (the common type 7 rule). */
export function quantile(xs: readonly number[], p: number): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

export const median = (xs: readonly number[]): number => quantile(xs, 0.5);

/** Pearson's correlation. */
export function correlation(xs: readonly number[], ys: readonly number[]): number {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i += 1) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

export const logit = (p: number): number => Math.log(p / (1 - p));
export const logistic = (x: number): number => 1 / (1 + Math.exp(-x));
