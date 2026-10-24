// Small numerical methods the thermodynamics engines share: Brent's root finder, a scan for every sign change on a
// grid, and Gauss-Legendre quadrature with nodes computed from the Legendre polynomials (no copied tables).
import { ThermoError } from './types';

/** A root of f on [a, b], where f(a) and f(b) differ in sign (Brent 1973). */
export function brent(f: (x: number) => number, a: number, b: number, tol = 1e-12, maxIter = 200): number {
  let fa = f(a);
  let fb = f(b);
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (!(fa * fb < 0)) throw new ThermoError('noRoot');
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
      a = b;
      b = c;
      c = a;
      fa = fb;
      fb = fc;
      fc = fa;
    }
    const tol1 = 2 * Number.EPSILON * Math.abs(b) + 0.5 * tol * Math.max(1, Math.abs(b));
    const m = 0.5 * (c - b);
    if (Math.abs(m) <= tol1 || fb === 0) return b;
    if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa;
      let p: number;
      let q: number;
      if (a === c) {
        p = 2 * m * s;
        q = 1 - s;
      } else {
        const r = fb / fc;
        const t = fa / fc;
        p = s * (2 * m * t * (t - r) - (b - a) * (r - 1));
        q = (t - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q;
      else p = -p;
      if (2 * p < Math.min(3 * m * q - Math.abs(tol1 * q), Math.abs(e * q))) {
        e = d;
        d = p / q;
      } else {
        d = m;
        e = d;
      }
    } else {
      d = m;
      e = d;
    }
    a = b;
    fa = fb;
    b += Math.abs(d) > tol1 ? d : m > 0 ? tol1 : -tol1;
    fb = f(b);
  }
  return b;
}

/** Every root of f on [a, b] found by sampling n intervals and polishing each sign change with Brent. */
export function scanRoots(f: (x: number) => number, a: number, b: number, n = 200, tol = 1e-12): number[] {
  const roots: number[] = [];
  let x0 = a;
  let f0 = f(a);
  for (let i = 1; i <= n; i++) {
    const x1 = a + ((b - a) * i) / n;
    const f1 = f(x1);
    if (f0 === 0) roots.push(x0);
    else if (f0 * f1 < 0) roots.push(brent(f, x0, x1, tol));
    x0 = x1;
    f0 = f1;
  }
  if (f0 === 0) roots.push(x0);
  return roots;
}

const legendreCache = new Map<number, { x: number[]; w: number[] }>();

/** Gauss-Legendre nodes and weights on [-1, 1], found by Newton on P_n. */
export function gaussLegendre(n: number): { x: number[]; w: number[] } {
  const cached = legendreCache.get(n);
  if (cached) return cached;
  const x: number[] = [];
  const w: number[] = [];
  for (let i = 1; i <= n; i++) {
    let z = Math.cos((Math.PI * (i - 0.25)) / (n + 0.5));
    let dp = 0;
    for (let iter = 0; iter < 100; iter++) {
      let p0 = 1;
      let p1 = z;
      for (let k = 2; k <= n; k++) {
        const p2 = ((2 * k - 1) * z * p1 - (k - 1) * p0) / k;
        p0 = p1;
        p1 = p2;
      }
      dp = (n * (z * p1 - p0)) / (z * z - 1);
      const dz = p1 / dp;
      z -= dz;
      if (Math.abs(dz) < 1e-15) break;
    }
    x.push(z);
    w.push(2 / ((1 - z * z) * dp * dp));
  }
  const rule = { x, w };
  legendreCache.set(n, rule);
  return rule;
}

/** The integral of f over [a, b] by 20-point Gauss-Legendre on equal panels. */
export function integrate(f: (x: number) => number, a: number, b: number, panels = 8): number {
  const { x, w } = gaussLegendre(20);
  const width = (b - a) / panels;
  let sum = 0;
  for (let p = 0; p < panels; p++) {
    const mid = a + (p + 0.5) * width;
    for (let i = 0; i < x.length; i++) sum += w[i] * f(mid + 0.5 * width * x[i]);
  }
  return 0.5 * width * sum;
}

/** n points spaced evenly from a to b. */
export function linspace(a: number, b: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
}
