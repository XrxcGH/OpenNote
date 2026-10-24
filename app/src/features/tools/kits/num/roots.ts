// Root finding for the kits. Brent's method (Brent 1973) mixes bisection, the secant rule, and inverse quadratic
// interpolation on a bracket, and is never slower than bisection. A scan finds every sign change on a grid and refines
// each. Newton's method for systems uses a numeric Jacobian and a backtracking line search.
import { NumError } from './errors';
import { solve, pinv, multiplyVector } from './matrix';

const EPS = 2 ** -52;

export interface RootResult {
  x: number;
  fx: number;
  iterations: number;
}

/** A root of f on [a, b], where f(a) and f(b) differ in sign. Throws 'noBracket' when they do not. */
export function brent(f: (x: number) => number, a0: number, b0: number, tol = 1e-12, maxIter = 200): RootResult {
  let a = a0;
  let b = b0;
  let fa = f(a);
  let fb = f(b);
  if (!Number.isFinite(fa) || !Number.isFinite(fb)) throw new NumError('notFinite', 'f is not finite at an end');
  if (fa === 0) return { x: a, fx: 0, iterations: 0 };
  if (fb === 0) return { x: b, fx: 0, iterations: 0 };
  if (fa > 0 === fb > 0) throw new NumError('noBracket');
  let c = a;
  let fc = fa;
  let d = b - a;
  let e = d;
  for (let iter = 1; iter <= maxIter; iter += 1) {
    if (fb > 0 === fc > 0) {
      c = a;
      fc = fa;
      d = b - a;
      e = d;
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      [a, b, c] = [b, c, b];
      [fa, fb, fc] = [fb, fc, fb];
    }
    const tol1 = 2 * EPS * Math.abs(b) + 0.5 * tol;
    const xm = 0.5 * (c - b);
    if (Math.abs(xm) <= tol1 || fb === 0) return { x: b, fx: fb, iterations: iter };
    if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
      const step = interpolate(a, b, c, fa, fb, fc, xm);
      if (2 * Math.abs(step.p) < Math.min(3 * xm * step.q - Math.abs(tol1 * step.q), Math.abs(e * step.q))) {
        e = d;
        d = step.p / step.q;
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
    b += Math.abs(d) > tol1 ? d : Math.sign(xm) * tol1;
    fb = f(b);
  }
  throw new NumError('noConvergence', 'brent');
}

/** The secant step (a = c) or the inverse quadratic step, as p/q with q made to point toward the bracket. */
function interpolate(a: number, b: number, c: number, fa: number, fb: number, fc: number, xm: number) {
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
  return { p: Math.abs(p), q };
}

/**
 * Every root of f on [lo, hi] that shows as a sign change on a grid of `samples` intervals, each refined by Brent's
 * method. A sign change across a pole (where |f| grows instead of shrinking) is left out.
 */
export function bracketScan(f: (x: number) => number, lo: number, hi: number, samples = 200, tol = 1e-12): number[] {
  if (!(hi > lo)) throw new NumError('domain', 'the interval is empty');
  const roots: number[] = [];
  let x0 = lo;
  let f0 = f(x0);
  for (let i = 1; i <= samples; i += 1) {
    const x1 = lo + ((hi - lo) * i) / samples;
    const f1 = f(x1);
    if (f0 === 0) roots.push(x0);
    else if (Number.isFinite(f0) && Number.isFinite(f1) && f0 > 0 !== f1 > 0 && f1 !== 0) {
      const root = brent(f, x0, x1, tol);
      if (Math.abs(root.fx) <= 1e-6 * (Math.abs(f0) + Math.abs(f1)) + 1e-12) roots.push(root.x);
    }
    x0 = x1;
    f0 = f1;
  }
  if (f0 === 0) roots.push(x0);
  return roots;
}

export interface NewtonStep {
  iteration: number;
  /** The largest |F_i| at the start of the step. */
  residual: number;
  /** The length of the step taken, after the line search. */
  step: number;
  /** The fraction of the full Newton step the line search kept. */
  damping: number;
}

export interface NewtonResult {
  x: number[];
  converged: boolean;
  iterations: number;
  residual: number;
  history: NewtonStep[];
}

const norm = (v: readonly number[]) => Math.hypot(...v);

/** The Jacobian of F at x by forward differences. */
export function numericJacobian(f: (x: number[]) => number[], x: readonly number[], fx: readonly number[]): number[][] {
  const columns = x.map((xj, j) => {
    const h = Math.sqrt(EPS) * Math.max(Math.abs(xj), 1);
    const shifted = [...x];
    shifted[j] = xj + h;
    const f1 = f(shifted);
    return f1.map((value, i) => (value - fx[i]) / h);
  });
  return fx.map((_, i) => columns.map((col) => col[i]));
}

/**
 * Solves F(x) = 0 by Newton's method from x0: a numeric Jacobian, the step from J dx = -F (least squares when J is
 * singular), and step halving until |F| shrinks. Reports each iteration so a tool can show convergence.
 */
export function newtonSystem(
  f: (x: number[]) => number[],
  x0: readonly number[],
  options: { tol?: number; maxIter?: number } = {},
): NewtonResult {
  const tol = options.tol ?? 1e-10;
  const maxIter = options.maxIter ?? 100;
  let x = [...x0];
  let fx = f(x);
  if (fx.length !== x.length) throw new NumError('shape', 'as many equations as unknowns are needed');
  const history: NewtonStep[] = [];
  for (let iteration = 1; iteration <= maxIter; iteration += 1) {
    const residual = Math.max(...fx.map(Math.abs));
    if (!Number.isFinite(residual)) throw new NumError('notFinite');
    if (residual <= tol) return { x, converged: true, iterations: iteration - 1, residual, history };
    const jac = numericJacobian(f, x, fx);
    const rhs = fx.map((v) => [-v]);
    let dx: number[];
    try {
      dx = solve(jac, rhs).map((row) => row[0]);
    } catch {
      dx = multiplyVector(pinv(jac), fx).map((v) => -v);
    }
    const start = norm(fx);
    let damping = 1;
    let next = x.map((xi, i) => xi + dx[i]);
    let fNext = f(next);
    while (!(norm(fNext) <= (1 - 1e-4 * damping) * start) && damping > 1 / 1024) {
      damping /= 2;
      next = x.map((xi, i) => xi + damping * dx[i]);
      fNext = f(next);
    }
    const step = damping * norm(dx);
    history.push({ iteration, residual, step, damping });
    x = next;
    fx = fNext;
    if (step <= tol * (norm(x) + tol)) {
      const last = Math.max(...fx.map(Math.abs));
      return { x, converged: last <= Math.sqrt(tol), iterations: iteration, residual: last, history };
    }
  }
  return { x, converged: false, iterations: maxIter, residual: Math.max(...fx.map(Math.abs)), history };
}
