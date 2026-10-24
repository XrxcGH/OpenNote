// The numerics the civil tools share: the error function, the exponential integral, adaptive quadrature, Brent's
// root finder, a dense linear solver, and least-squares fits. Each is small and tested against known values.
import { CivilError } from './types';

const SQRT_PI = Math.sqrt(Math.PI);
export const EULER_GAMMA = 0.5772156649015329;

/** e^(x²) erfc(x) for x ≥ 2.5, by the continued fraction (Lentz). */
function erfcxTail(x: number): number {
  const tiny = 1e-300;
  let f = x;
  let c = x;
  let d = 0;
  for (let n = 1; n < 500; n++) {
    const a = n / 2;
    d = x + a * d;
    d = Math.abs(d) < tiny ? 1 / tiny : 1 / d;
    c = x + a / c;
    if (Math.abs(c) < tiny) c = tiny;
    const delta = c * d;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return 1 / (SQRT_PI * f);
}

/** erf(x) for 0 ≤ x < 2.5 by its series of positive terms. */
function erfSeries(x: number): number {
  let term = x;
  let sum = x;
  for (let n = 1; n < 200; n++) {
    term *= (2 * x * x) / (2 * n + 1);
    sum += term;
    if (term < 1e-17 * sum) break;
  }
  return (2 / SQRT_PI) * Math.exp(-x * x) * sum;
}

export function erf(x: number): number {
  if (x < 0) return -erf(-x);
  return x < 2.5 ? erfSeries(x) : 1 - Math.exp(-x * x) * erfcxTail(x);
}

export function erfc(x: number): number {
  if (x < 0) return 2 - erfc(-x);
  return x < 2.5 ? 1 - erfSeries(x) : Math.exp(-x * x) * erfcxTail(x);
}

/** e^p erfc(q), without overflow when both p and q are large. */
export function expErfc(a: number, b: number): number {
  if (b < 2.5) return Math.exp(a) * erfc(b);
  return Math.exp(a - b * b) * erfcxTail(b);
}

/** The exponential integral E1(u) = ∫_u^∞ e^(-t)/t dt, for u > 0 (the Theis well function). */
export function expint1(u: number): number {
  if (!(u > 0)) throw new CivilError('errors.positive', { name: 'u' });
  if (u <= 1) {
    let sum = 0;
    let term = 1;
    for (let k = 1; k < 200; k++) {
      term *= -u / k;
      const add = -term / k;
      sum += add;
      if (Math.abs(add) < 1e-17 * Math.abs(sum)) break;
    }
    return -EULER_GAMMA - Math.log(u) + sum;
  }
  let b = u + 1;
  let c = 1e300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * i;
    b += 2;
    d = 1 / (an * d + b);
    c = b + an / c;
    const delta = c * d;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return h * Math.exp(-u);
}

type Fn = (x: number) => number;

function simpson(
  f: Fn,
  a: number,
  b: number,
  ends: [number, number, number],
  whole: number,
  tol: number,
  depth: number,
): number {
  const [fa, fm, fb] = ends;
  const m = (a + b) / 2;
  const lm = (a + m) / 2;
  const rm = (m + b) / 2;
  const flm = f(lm);
  const frm = f(rm);
  const left = ((m - a) / 6) * (fa + 4 * flm + fm);
  const right = ((b - m) / 6) * (fm + 4 * frm + fb);
  const delta = left + right - whole;
  if (depth <= 0 || Math.abs(delta) <= 15 * tol) return left + right + delta / 15;
  return (
    simpson(f, a, m, [fa, flm, fm], left, tol / 2, depth - 1) +
    simpson(f, m, b, [fm, frm, fb], right, tol / 2, depth - 1)
  );
}

/** ∫_a^b f by adaptive Simpson's rule on 16 first panels, to an absolute tolerance. */
export function quad(f: Fn, a: number, b: number, tol = 1e-11): number {
  const panels = 16;
  const h = (b - a) / panels;
  let total = 0;
  for (let i = 0; i < panels; i++) {
    const x0 = a + i * h;
    const x1 = x0 + h;
    const ends: [number, number, number] = [f(x0), f((x0 + x1) / 2), f(x1)];
    const whole = (h / 6) * (ends[0] + 4 * ends[1] + ends[2]);
    total += simpson(f, x0, x1, ends, whole, tol / panels, 40);
  }
  return total;
}

/** A root of f in [lo, hi], where f changes sign, by Brent's method. */
export function brent(f: Fn, lo: number, hi: number, tol = 1e-13, maxIter = 300): number {
  let a = lo;
  let b = hi;
  let fa = f(a);
  let fb = f(b);
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (fa * fb > 0) throw new CivilError('errors.noRoot');
  let c = a;
  let fc = fa;
  let d = b - a;
  let e = d;
  for (let i = 0; i < maxIter; i++) {
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
    const xm = (c - b) / 2;
    if (Math.abs(xm) <= tol1 || fb === 0) return b;
    if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa;
      let p: number;
      let q: number;
      if (a === c) {
        p = 2 * xm * s;
        q = 1 - s;
      } else {
        const qa = fa / fc;
        const r = fb / fc;
        p = s * (2 * xm * qa * (qa - r) - (b - a) * (r - 1));
        q = (qa - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q;
      p = Math.abs(p);
      if (2 * p < Math.min(3 * xm * q - Math.abs(tol1 * q), Math.abs(e * q))) {
        e = d;
        d = p / q;
      } else {
        d = xm;
        e = d;
      }
    } else {
      d = xm;
      e = d;
    }
    a = b;
    fa = fb;
    b += Math.abs(d) > tol1 ? d : xm > 0 ? tol1 : -tol1;
    fb = f(b);
  }
  throw new CivilError('errors.noConvergence');
}

/** A root of an increasing or decreasing f on (lo, ∞): the bracket grows by doubling until f changes sign. */
export function rootAbove(f: Fn, lo: number, start: number, tol = 1e-13): number {
  let hi = start;
  for (let i = 0; i < 200 && f(lo) * f(hi) > 0; i++) hi *= 2;
  return brent(f, lo, hi, tol);
}

/** Solves A x = b by Gaussian elimination with partial pivoting. A singular matrix is an error. */
export function solveLinear(matrix: readonly (readonly number[])[], rhs: readonly number[]): number[] {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]!]);
  const scale = Math.max(1e-300, ...a.flatMap((row) => row.slice(0, n).map(Math.abs)));
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(a[i]![k]!) > Math.abs(a[pivot]![k]!)) pivot = i;
    if (Math.abs(a[pivot]![k]!) < 1e-12 * scale) throw new CivilError('errors.singular');
    [a[k], a[pivot]] = [a[pivot]!, a[k]!];
    const rowK = a[k]!;
    for (let i = k + 1; i < n; i++) {
      const row = a[i]!;
      const factor = row[k]! / rowK[k]!;
      for (let j = k; j <= n; j++) row[j]! -= factor * rowK[j]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    const row = a[i]!;
    let sum = row[n]!;
    for (let j = i + 1; j < n; j++) sum -= row[j]! * x[j]!;
    x[i] = sum / row[i]!;
  }
  return x;
}

export interface Fit {
  p: number[];
  cost: number;
  iterations: number;
}

/** Levenberg-Marquardt least squares: the parameters that make the residuals smallest, from a first guess. */
export function leastSquares(residuals: (p: readonly number[]) => number[], p0: readonly number[], maxIter = 300): Fit {
  let p = [...p0];
  let r = residuals(p);
  let cost = r.reduce((s, v) => s + v * v, 0);
  let lambda = 1e-3;
  let iterations = 0;
  for (; iterations < maxIter; iterations++) {
    const jac = p.map((value, j) => {
      const h = 1e-7 * Math.max(Math.abs(value), 1e-7);
      const shifted = [...p];
      shifted[j] = value + h;
      return residuals(shifted).map((v, i) => (v - r[i]!) / h);
    });
    const jtj = p.map((_, i) => p.map((__, k) => jac[i]!.reduce((s, v, m) => s + v * jac[k]![m]!, 0)));
    const jtr = p.map((_, i) => jac[i]!.reduce((s, v, m) => s + v * r[m]!, 0));
    let improved = false;
    for (let tries = 0; tries < 30 && !improved; tries++) {
      const damped = jtj.map((row, i) => row.map((v, k) => (i === k ? v * (1 + lambda) + 1e-300 : v)));
      let step: number[];
      try {
        step = solveLinear(
          damped,
          jtr.map((v) => -v),
        );
      } catch {
        lambda *= 10;
        continue;
      }
      const next = p.map((v, i) => v + step[i]!);
      const nextR = residuals(next);
      const nextCost = nextR.reduce((s, v) => s + v * v, 0);
      if (Number.isFinite(nextCost) && nextCost < cost) {
        const small = step.every((s, i) => Math.abs(s) <= 1e-12 * (Math.abs(p[i]!) + 1e-12));
        p = next;
        r = nextR;
        const drop = cost - nextCost;
        cost = nextCost;
        lambda = Math.max(lambda / 10, 1e-12);
        improved = true;
        if (small || drop <= 1e-15 * cost) return { p, cost, iterations: iterations + 1 };
      } else lambda *= 10;
    }
    if (!improved) break;
  }
  return { p, cost, iterations };
}

export interface LineFit {
  slope: number;
  intercept: number;
  r2: number;
}

/** The least-squares straight line through the points. */
export function lineFit(x: readonly number[], y: readonly number[]): LineFit {
  const n = x.length;
  if (n < 2) throw new CivilError('errors.fewPoints', { count: 2 });
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (x[i]! - mx) ** 2;
    sxy += (x[i]! - mx) * (y[i]! - my);
    syy += (y[i]! - my) ** 2;
  }
  if (sxx === 0) throw new CivilError('errors.sameX');
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r2: syy === 0 ? 1 : (sxy * sxy) / (sxx * syy) };
}

/** A least-squares polynomial: coefficients from the constant term up, in powers of (x - center). */
export function polyFit(x: readonly number[], y: readonly number[], degree: number): { c: number[]; center: number } {
  if (x.length <= degree) throw new CivilError('errors.fewPoints', { count: degree + 1 });
  const center = x.reduce((s, v) => s + v, 0) / x.length;
  const rows = x.map((v) => Array.from({ length: degree + 1 }, (_, k) => (v - center) ** k));
  const ata = rows[0]!.map((_, i) => rows[0]!.map((__, k) => rows.reduce((s, row) => s + row[i]! * row[k]!, 0)));
  const aty = rows[0]!.map((_, i) => rows.reduce((s, row, m) => s + row[i]! * y[m]!, 0));
  return { c: solveLinear(ata, aty), center };
}

export const polyAt = (fit: { c: readonly number[]; center: number }, x: number): number =>
  fit.c.reduce((s, ck, k) => s + ck * (x - fit.center) ** k, 0);

/** The x in [a, b] where f is largest, by golden-section search (f is taken to have one peak there). */
export function maximize(f: Fn, a: number, b: number, tol = 1e-10): number {
  const g = (Math.sqrt(5) - 1) / 2;
  let lo = a;
  let hi = b;
  let x1 = hi - g * (hi - lo);
  let x2 = lo + g * (hi - lo);
  let f1 = f(x1);
  let f2 = f(x2);
  while (hi - lo > tol * (1 + Math.abs(lo) + Math.abs(hi))) {
    if (f1 < f2) {
      lo = x1;
      x1 = x2;
      f1 = f2;
      x2 = lo + g * (hi - lo);
      f2 = f(x2);
    } else {
      hi = x2;
      x2 = x1;
      f2 = f1;
      x1 = hi - g * (hi - lo);
      f1 = f(x1);
    }
  }
  return (lo + hi) / 2;
}

/** Evenly spaced values from a to b, both included. */
export function linspace(a: number, b: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => a + ((b - a) * i) / (count - 1));
}

/** Values spaced evenly on a log scale from a to b. */
export function logspace(a: number, b: number, count: number): number[] {
  return linspace(Math.log10(a), Math.log10(b), count).map((v) => 10 ** v);
}

/** The area under the points by the trapezoid rule. */
export function trapz(x: readonly number[], y: readonly number[]): number {
  let sum = 0;
  for (let i = 1; i < x.length; i++) sum += ((x[i]! - x[i - 1]!) * (y[i]! + y[i - 1]!)) / 2;
  return sum;
}
