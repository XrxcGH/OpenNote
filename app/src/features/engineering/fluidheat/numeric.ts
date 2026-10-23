// Small numeric helpers shared by the fluid and heat tools: a bracketed root finder, a bracket scan, and Bessel functions of real argument.

export const G0 = 9.80665;
export const SIGMA = 5.670374419e-8;

/** One line of worked steps. `key` names a string in the tool's namespace; `vars` fill its placeholders; `math` is LaTeX. */
export interface Step {
  key: string;
  vars?: Record<string, string>;
  math?: string;
}

export class CalcError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CalcError';
  }
}

/** Brent's method on a sign-changing bracket [a, b]. */
export function brent(f: (x: number) => number, a: number, b: number, tol = 1e-13, maxIter = 200): number {
  let fa = f(a);
  let fb = f(b);
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (fa * fb > 0)
    throw new CalcError('bracket', 'The root is not bracketed: the function has the same sign at both ends.');
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

/** Every sign change of f on [lo, hi] sampled at n+1 points, each refined by Brent. */
export function bracketScan(f: (x: number) => number, lo: number, hi: number, n: number): number[] {
  const roots: number[] = [];
  let x0 = lo;
  let f0 = f(x0);
  for (let i = 1; i <= n; i++) {
    const x1 = lo + ((hi - lo) * i) / n;
    const f1 = f(x1);
    if (f0 === 0) roots.push(x0);
    else if (f0 * f1 < 0) roots.push(brent(f, x0, x1));
    x0 = x1;
    f0 = f1;
  }
  return roots;
}

/** Modified Bessel I0 and I1 by their power series (accurate to machine precision for x up to about 30). */
export function besselI(order: 0 | 1, x: number): number {
  const half = x / 2;
  let term = order === 0 ? 1 : half;
  let sum = term;
  const q = half * half;
  for (let k = 1; k < 200; k++) {
    term *= q / (k * (k + order));
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * 1e-17) break;
  }
  return sum;
}

/** Bessel J0 and J1 by power series for small x and the Hankel expansion for large x. */
export function besselJ(order: 0 | 1, x: number): number {
  const ax = Math.abs(x);
  if (ax < 12) {
    const half = ax / 2;
    let term = order === 0 ? 1 : half;
    let sum = term;
    const q = -half * half;
    for (let k = 1; k < 100; k++) {
      term *= q / (k * (k + order));
      sum += term;
      if (Math.abs(term) < 1e-18 * Math.abs(sum) + 1e-300) break;
    }
    return order === 1 && x < 0 ? -sum : sum;
  }
  const mu = 4 * order * order;
  let P = 1;
  let Q = 0;
  let tp = 1;
  const z = 8 * ax;
  // asymptotic series P and Q (A&S 9.2.9 and 9.2.10), truncated at the smallest term
  let prev = Infinity;
  for (let k = 1; k < 40; k++) {
    tp *= (mu - (2 * k - 1) ** 2) / (k * z);
    if (Math.abs(tp) > prev) break;
    prev = Math.abs(tp);
    if (k % 2 === 1) Q += (k % 4 === 1 ? 1 : -1) * tp;
    else P += (k % 4 === 2 ? -1 : 1) * tp;
  }
  const chi = ax - (order === 0 ? 0.25 : 0.75) * Math.PI;
  const v = Math.sqrt(2 / (Math.PI * ax)) * (P * Math.cos(chi) - Q * Math.sin(chi));
  return order === 1 && x < 0 ? -v : v;
}

/** Modified Bessel K0 and K1 (x > 0): series with Euler's constant for x <= 2, the integral form above. */
export function besselK(order: 0 | 1, x: number): number {
  if (!(x > 0)) throw new CalcError('domain', 'K needs a positive argument.');
  if (x <= 2) {
    const gamma = 0.5772156649015329;
    const half = x / 2;
    const q = half * half;
    if (order === 0) {
      let term = 1;
      let h = 0;
      let s = 0;
      for (let k = 1; k < 60; k++) {
        term *= q / (k * k);
        h += 1 / k;
        s += term * h;
        if (term * h < 1e-18) break;
      }
      return -(Math.log(half) + gamma) * besselI(0, x) + s;
    }
    let term = 1;
    let s = 0;
    let hk = 0;
    for (let k = 0; k < 60; k++) {
      if (k > 0) {
        term *= q / (k * (k + 1));
        hk += 1 / k;
      }
      const hk1 = hk + 1 / (k + 1);
      s += term * (-2 * gamma + hk + hk1);
      if (k > 3 && Math.abs(term) < 1e-18) break;
    }
    return 1 / x + Math.log(half) * besselI(1, x) - (x / 4) * s;
  }
  // K_nu(x) = integral from 0 to infinity of exp(-x cosh t) cosh(nu t) dt, by the trapezoid rule (converges geometrically)
  const h = 0.05;
  let sum = 0.5 * Math.exp(-x);
  for (let i = 1; i < 400; i++) {
    const t = i * h;
    const term = Math.exp(-x * Math.cosh(t)) * Math.cosh(order * t);
    sum += term;
    if (term < 1e-20 * sum) break;
  }
  return sum * h;
}

export const sq = (x: number): number => x * x;
export const cube = (x: number): number => x * x * x;

/** Significant-figure formatting for step variables. */
export function fmt(x: number, sig = 5): string {
  if (!Number.isFinite(x)) return String(x);
  if (x === 0) return '0';
  const a = Math.abs(x);
  if (a >= 1e6 || a < 1e-3) return Number(x.toPrecision(sig)).toExponential().replace('e+', 'e');
  return String(Number(x.toPrecision(sig)));
}

export function need(cond: boolean, code: string, message: string): void {
  if (!cond) throw new CalcError(code, message);
}
export function positive(x: number, name: string): void {
  need(Number.isFinite(x) && x > 0, 'positive', `${name} must be a positive number.`);
}
export function nonNegative(x: number, name: string): void {
  need(Number.isFinite(x) && x >= 0, 'nonnegative', `${name} must be zero or more.`);
}
