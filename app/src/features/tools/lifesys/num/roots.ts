// Brent's method for a root in a bracket, and a scan that finds a bracket first. The engines use it for the
// Euler-Lotka equation, the epidemic final size, and threshold searches.
import { LsError } from './errors';

/** A root of f in the bracket [a, b], where f changes sign. Throws errors.bracket when it does not. */
export function brent(f: (x: number) => number, a: number, b: number, tol = 1e-12, maxIter = 200): number {
  let fa = f(a);
  let fb = f(b);
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (!(fa * fb < 0)) throw new LsError('errors.bracket');
  let c = a;
  let fc = fa;
  let d = b - a;
  let e = d;
  for (let i = 0; i < maxIter; i += 1) {
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
        const r = fb / fc;
        const qa = fa / fc;
        p = s * (2 * m * qa * (qa - r) - (b - a) * (r - 1));
        q = (qa - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q;
      p = Math.abs(p);
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
  throw new LsError('errors.converge');
}

/** Splits [a, b] into n parts and returns the first sub-interval where f changes sign, or null. */
export function bracket(f: (x: number) => number, a: number, b: number, n = 200): [number, number] | null {
  let x0 = a;
  let f0 = f(a);
  for (let i = 1; i <= n; i += 1) {
    const x1 = a + ((b - a) * i) / n;
    const f1 = f(x1);
    if (f0 === 0) return [x0, x0];
    if (f0 * f1 < 0 || f1 === 0) return [x0, x1];
    x0 = x1;
    f0 = f1;
  }
  return null;
}
