// An adaptive Dormand-Prince 5(4) integrator for the kit's models: neurons, drug compartments, populations and
// reaction networks. It keeps every accepted step, so a plot shows the curve as computed, and a maximum step keeps
// fast events (an action potential, a dose) from being stepped over.
import { LsError } from './errors';

export type Rhs = (t: number, y: readonly number[]) => number[];

export interface OdeOptions {
  /** Relative tolerance per component (default 1e-6). */
  rtol?: number;
  /** Absolute tolerance per component (default 1e-9). */
  atol?: number;
  /** The largest step allowed (default: the whole span / 50). */
  maxStep?: number;
  /** The most steps before giving up (default 200 000). */
  maxSteps?: number;
}

export interface OdeSolution {
  t: number[];
  y: number[][];
}

const C = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1];
const A: readonly (readonly number[])[] = [
  [],
  [1 / 5],
  [3 / 40, 9 / 40],
  [44 / 45, -56 / 15, 32 / 9],
  [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
  [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
];
// Fifth-order weights are the last row of A; these are the differences to the embedded fourth-order solution.
const E = [71 / 57600, 0, -71 / 16695, 71 / 1920, -17253 / 339200, 22 / 525, -1 / 40];

function stage(y: readonly number[], k: readonly number[][], row: readonly number[], h: number): number[] {
  return y.map((value, i) => {
    let sum = value;
    for (let j = 0; j < row.length; j += 1) sum += h * row[j] * k[j][i];
    return sum;
  });
}

/** One trial step: the fifth-order value and its error norm (1 means at tolerance). */
function trial(f: Rhs, t: number, y: readonly number[], k0: number[], h: number, rtol: number, atol: number) {
  const k: number[][] = [k0];
  for (let s = 1; s < 7; s += 1) k.push(f(t + C[s] * h, stage(y, k, A[s], h)));
  const next = stage(y, k, A[6], h);
  let norm = 0;
  for (let i = 0; i < y.length; i += 1) {
    let err = 0;
    for (let s = 0; s < 7; s += 1) err += E[s] * k[s][i];
    const scale = atol + rtol * Math.max(Math.abs(y[i]), Math.abs(next[i]));
    norm = Math.max(norm, Math.abs(h * err) / scale);
  }
  return { next, norm, kLast: k[6] };
}

/** Integrates y' = f(t, y) from t0 to t1 (t1 > t0). Throws errors.ode when the step size collapses. */
export function dopri(f: Rhs, y0: readonly number[], t0: number, t1: number, options: OdeOptions = {}): OdeSolution {
  const rtol = options.rtol ?? 1e-6;
  const atol = options.atol ?? 1e-9;
  const span = t1 - t0;
  if (!(span > 0)) throw new LsError('errors.span');
  const maxStep = Math.min(options.maxStep ?? span / 50, span);
  const maxSteps = options.maxSteps ?? 200_000;
  const out: OdeSolution = { t: [t0], y: [[...y0]] };
  let t = t0;
  let y = [...y0];
  let k0 = f(t, y);
  let h = Math.min(maxStep, span / 100);
  for (let steps = 0; t < t1; steps += 1) {
    if (steps > maxSteps) throw new LsError('errors.ode');
    // The last step lands on t1 exactly: t + (t1 - t) can round one ulp short in floating point, which used to leave
    // a remainder near 1e-16 that tripped the collapse guard below.
    const last = t + h >= t1 || t1 - (t + h) <= span * 1e-12;
    if (last) h = t1 - t;
    const { next, norm, kLast } = trial(f, t, y, k0, h, rtol, atol);
    if (!Number.isFinite(norm)) throw new LsError('errors.ode');
    const accepted = norm <= 1;
    if (accepted) {
      t = last ? t1 : t + h;
      y = next;
      k0 = kLast;
      out.t.push(t);
      out.y.push(y);
    }
    const factor = norm === 0 ? 5 : Math.min(5, Math.max(0.2, 0.9 * norm ** -0.2));
    h = Math.min(maxStep, h * factor);
    // Only a rejected step means the accuracy cannot be held; a short accepted final step is fine.
    if (!accepted && h < span * 1e-14) throw new LsError('errors.ode');
  }
  return out;
}

/** The solution's value at time s, by linear interpolation between accepted steps. */
export function valueAt(solution: OdeSolution, s: number, component = 0): number {
  const { t, y } = solution;
  if (s <= t[0]) return y[0][component];
  let low = 0;
  let high = t.length - 1;
  if (s >= t[high]) return y[high][component];
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (t[mid] <= s) low = mid;
    else high = mid;
  }
  const w = (s - t[low]) / (t[high] - t[low]);
  return y[low][component] * (1 - w) + y[high][component] * w;
}
