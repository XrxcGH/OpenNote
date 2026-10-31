// Small numeric helpers the tools share: root finding, a straight-line fit, and the error function.

/** A root of f in [a, b] by Brent's method; null when f does not change sign there. */
export function brent(f: (x: number) => number, a: number, b: number, tol = 1e-300, maxIter = 400): number | null {
  let fa = f(a);
  let fb = f(b);
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (!Number.isFinite(fa) || !Number.isFinite(fb) || fa * fb > 0) return null;
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
    const tol1 = 2 * Number.EPSILON * Math.abs(b) + 0.5 * tol;
    const xm = 0.5 * (c - b);
    if (Math.abs(xm) <= tol1 || fb === 0) return b;
    if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa;
      let p: number;
      let q: number;
      if (a === c) {
        p = 2 * xm * s;
        q = 1 - s;
      } else {
        const qq = fa / fc;
        const r = fb / fc;
        p = s * (2 * xm * qq * (qq - r) - (b - a) * (r - 1));
        q = (qq - 1) * (r - 1) * (s - 1);
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
  return b;
}

/** Every root of f in [a, b], found by a sign scan on `n` steps (log-spaced when `log`), each polished by Brent. */
export function bracketScan(f: (x: number) => number, a: number, b: number, n = 400, log = false): number[] {
  const at = (i: number) => (log ? a * Math.pow(b / a, i / n) : a + ((b - a) * i) / n);
  const roots: number[] = [];
  let x0 = at(0);
  let f0 = f(x0);
  for (let i = 1; i <= n; i++) {
    const x1 = at(i);
    const f1 = f(x1);
    if (f0 === 0) roots.push(x0);
    else if (Number.isFinite(f0) && Number.isFinite(f1) && f0 * f1 < 0) {
      const r = brent(f, x0, x1);
      if (r !== null) roots.push(r);
    }
    x0 = x1;
    f0 = f1;
  }
  if (f0 === 0) roots.push(x0);
  return roots;
}

export interface LineFit {
  slope: number;
  intercept: number;
  /** Coefficient of determination; 1 for a perfect line. */
  r2: number;
  slopeSe: number;
  interceptSe: number;
  n: number;
}

/** Least-squares line y = intercept + slope x, with standard errors (n > 2) and R squared. */
export function lineFit(xs: readonly number[], ys: readonly number[]): LineFit | null {
  const n = xs.length;
  if (n < 2 || ys.length !== n) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (ys[i] - intercept - slope * xs[i]) ** 2;
  const r2 = syy === 0 ? 1 : Math.max(0, 1 - sse / syy);
  const s2 = n > 2 ? sse / (n - 2) : 0;
  const slopeSe = Math.sqrt(s2 / sxx);
  const interceptSe = Math.sqrt(s2 * (1 / n + (mx * mx) / sxx));
  return { slope, intercept, r2, slopeSe, interceptSe, n };
}

/** erfc for x >= 3 by a continued fraction. */
function erfcLarge(x: number): number {
  let f = 0;
  for (let k = 60; k >= 1; k--) f = k / 2 / (x + f);
  return Math.exp(-x * x) / Math.sqrt(Math.PI) / (x + f);
}

/** The error function, to about 15 digits: a Maclaurin series for small |x| and a continued fraction beyond. */
export function erf(x: number): number {
  if (x === 0) return 0;
  const ax = Math.abs(x);
  if (ax > 6) return Math.sign(x);
  if (ax < 3) {
    let term = ax;
    let sum = ax;
    for (let n = 1; n < 200; n++) {
      term *= (-ax * ax) / n;
      const add = term / (2 * n + 1);
      sum += add;
      if (Math.abs(add) < 1e-17 * Math.abs(sum)) break;
    }
    return (Math.sign(x) * 2 * sum) / Math.sqrt(Math.PI);
  }
  return Math.sign(x) * (1 - erfcLarge(ax));
}

export function erfc(x: number): number {
  return x >= 3 ? erfcLarge(x) : 1 - erf(x);
}

/** The inverse error function for |y| < 1, by Newton's method from a good starting guess. */
export function erfinv(y: number): number {
  if (y <= -1 || y >= 1) return NaN;
  if (y === 0) return 0;
  const a = 0.147;
  const ln = Math.log(1 - y * y);
  const t = 2 / (Math.PI * a) + ln / 2;
  let x = Math.sign(y) * Math.sqrt(Math.sqrt(t * t - ln / a) - t);
  for (let i = 0; i < 8; i++) {
    const err = erf(x) - y;
    x -= err / ((2 / Math.sqrt(Math.PI)) * Math.exp(-x * x));
  }
  return x;
}
