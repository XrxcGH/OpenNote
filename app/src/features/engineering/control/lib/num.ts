// Scalar numerics for the control tools: a bracketed root finder, a bracketed maximum, adaptive quadrature and
// grids. Plain arithmetic; nothing here reads text.

/** Brent's method for f(x) = 0 on [a, b] where f(a) and f(b) differ in sign. Returns NaN without a bracket. */
export function brent(f: (x: number) => number, a0: number, b0: number, tol = 1e-13, maxIter = 200): number {
  let a = a0;
  let b = b0;
  let fa = f(a);
  let fb = f(b);
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (!(fa * fb < 0)) return Number.NaN;
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

/** Every root of f on a grid of x values: each sign change is refined by Brent's method. */
export function rootsOnGrid(f: (x: number) => number, xs: readonly number[], tol = 1e-13): number[] {
  const out: number[] = [];
  let x0 = xs[0];
  let f0 = f(x0);
  if (f0 === 0) out.push(x0);
  for (let i = 1; i < xs.length; i += 1) {
    const x1 = xs[i];
    const f1 = f(x1);
    if (f1 === 0) out.push(x1);
    else if (f0 !== 0 && Number.isFinite(f0) && Number.isFinite(f1) && f0 * f1 < 0) {
      const r = brent(f, x0, x1, tol);
      if (Number.isFinite(r)) out.push(r);
    }
    x0 = x1;
    f0 = f1;
  }
  return out;
}

/** The maximum of a unimodal f on [a, b] by golden-section search. */
export function goldenMax(f: (x: number) => number, a0: number, b0: number, tol = 1e-12): number {
  const g = (Math.sqrt(5) - 1) / 2;
  let a = a0;
  let b = b0;
  let c = b - g * (b - a);
  let d = a + g * (b - a);
  let fc = f(c);
  let fd = f(d);
  for (let i = 0; i < 200 && Math.abs(b - a) > tol * Math.max(1, Math.abs(a) + Math.abs(b)); i += 1) {
    if (fc > fd) {
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

/** n points from a to b inclusive. */
export const linspace = (a: number, b: number, n: number): number[] =>
  Array.from({ length: n }, (_, i) => (n === 1 ? a : a + ((b - a) * i) / (n - 1)));

/** n points from 10^a to 10^b inclusive. */
export const logspace = (a: number, b: number, n: number): number[] => linspace(a, b, n).map((e) => 10 ** e);

// Gauss–Kronrod 7–15 nodes and weights (published by Kronrod, 1965; the values are mathematical constants).
const XGK = [
  0.9914553711208126, 0.9491079123427585, 0.8648644233597691, 0.7415311855993945, 0.5860872354676911,
  0.4058451513773972, 0.20778495500789848, 0,
];
const WGK = [
  0.022935322010529224, 0.06309209262997856, 0.10479001032225019, 0.14065325971552592, 0.1690047266392679,
  0.19035057806478542, 0.20443294007529889, 0.20948214108472782,
];
const WG = [0.1294849661688697, 0.27970539148927664, 0.3818300505051189, 0.4179591836734694];

function gk15(f: (x: number) => number, a: number, b: number): { value: number; error: number } {
  const c = (a + b) / 2;
  const h = (b - a) / 2;
  const fc = f(c);
  let k = WGK[7] * fc;
  let g = WG[3] * fc;
  for (let i = 0; i < 7; i += 1) {
    const dx = h * XGK[i];
    const s = f(c - dx) + f(c + dx);
    k += WGK[i] * s;
    if (i % 2 === 1) g += WG[(i - 1) / 2] * s;
  }
  return { value: k * h, error: Math.abs((k - g) * h) };
}

/**
 * Globally adaptive Gauss–Kronrod quadrature of f on a finite [a, b]: the interval with the largest error estimate
 * is split until the total error is below tol (absolute) or relTol (relative), or 4000 intervals are in use.
 */
export function integrate(f: (x: number) => number, a: number, b: number, tol = 1e-11, relTol = 1e-12): number {
  if (a === b) return 0;
  const parts = [{ a, b, ...gk15(f, a, b) }];
  let total = parts[0].value;
  let error = parts[0].error;
  while (error > Math.max(tol, relTol * Math.abs(total)) && parts.length < 4000) {
    let worst = 0;
    for (let i = 1; i < parts.length; i += 1) if (parts[i].error > parts[worst].error) worst = i;
    const w = parts[worst];
    const m = (w.a + w.b) / 2;
    if (m <= w.a || m >= w.b) break;
    const left = { a: w.a, b: m, ...gk15(f, w.a, m) };
    const right = { a: m, b: w.b, ...gk15(f, m, w.b) };
    parts.splice(worst, 1, left, right);
    total = 0;
    error = 0;
    for (const p of parts) {
      total += p.value;
      error += p.error;
    }
  }
  return total;
}

/** ∫ₐ^∞ f by the substitution x = a + scale · t/(1 − t); scale should be near the width of f. */
export function integrateToInfinity(f: (x: number) => number, a: number, tol = 1e-10, scale = 1): number {
  return integrate(
    (t) => {
      if (t >= 1) return 0;
      const x = a + (scale * t) / (1 - t);
      const v = (scale * f(x)) / ((1 - t) * (1 - t));
      return Number.isFinite(v) ? v : 0;
    },
    0,
    1,
    tol,
  );
}

/** A finite number check that also rejects NaN. */
export const finite = (x: number): boolean => Number.isFinite(x);
