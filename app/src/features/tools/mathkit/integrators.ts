// Initial value problem solvers, written to be read: Euler, Heun, classic Runge-Kutta, the adaptive Dormand-Prince
// pair, and backward Euler for stiff problems. A solver returns every step it took, so the tool can show the table.
import { newtonSystem } from './dense';

export type Rhs = (t: number, y: readonly number[]) => number[];

export interface Point {
  t: number;
  y: number[];
}

export type FixedMethod = 'euler' | 'heun' | 'rk4' | 'backward-euler';

const axpy = (y: readonly number[], a: number, k: readonly number[]): number[] => y.map((v, i) => v + a * k[i]);

function stepOnce(method: FixedMethod, f: Rhs, t: number, y: readonly number[], h: number): number[] {
  if (method === 'euler') return axpy(y, h, f(t, y));
  if (method === 'heun') {
    const k1 = f(t, y);
    const k2 = f(t + h, axpy(y, h, k1));
    return y.map((v, i) => v + (h / 2) * (k1[i] + k2[i]));
  }
  if (method === 'rk4') {
    const k1 = f(t, y);
    const k2 = f(t + h / 2, axpy(y, h / 2, k1));
    const k3 = f(t + h / 2, axpy(y, h / 2, k2));
    const k4 = f(t + h, axpy(y, h, k3));
    return y.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
  }
  // Backward Euler: solve y1 = y + h f(t + h, y1) by Newton's method, starting from a forward step.
  const start = axpy(y, h, f(t, y));
  const solved = newtonSystem((y1) => y1.map((v, i) => v - y[i] - h * f(t + h, y1)[i]), start, { tolerance: 1e-13 });
  return solved.x;
}

/** Fixed steps of size h from t0 to tEnd (the last step is shortened to land on tEnd). */
export function fixedSteps(
  method: FixedMethod,
  f: Rhs,
  t0: number,
  y0: readonly number[],
  tEnd: number,
  h: number,
): Point[] {
  if (!(h > 0) || !Number.isFinite(h)) throw new RangeError('step');
  const direction = tEnd >= t0 ? 1 : -1;
  const points: Point[] = [{ t: t0, y: y0.slice() }];
  let t = t0;
  let y = y0.slice();
  for (let n = 0; n < 1_000_000; n++) {
    const remaining = Math.abs(tEnd - t);
    if (remaining < 1e-12 * Math.max(1, Math.abs(tEnd))) break;
    const size = Math.min(h, remaining) * direction;
    y = stepOnce(method, f, t, y, size);
    t += size;
    points.push({ t, y: y.slice() });
  }
  return points;
}

const C = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1];
const A = [
  [],
  [1 / 5],
  [3 / 40, 9 / 40],
  [44 / 45, -56 / 15, 32 / 9],
  [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
  [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
];
const B5 = [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0];
const B4 = [5179 / 57600, 0, 7571 / 16695, 393 / 640, -92097 / 339200, 187 / 2100, 1 / 40];

export interface AdaptiveOptions {
  rtol?: number;
  atol?: number;
  maxSteps?: number;
  /** Stop early when this returns true for an accepted point (for trajectories that leave a window). */
  stop?: (point: Point) => boolean;
}

/** The adaptive Dormand-Prince 5(4) method, run in either direction of time. */
export function dopri45(
  f: Rhs,
  t0: number,
  y0: readonly number[],
  tEnd: number,
  options: AdaptiveOptions = {},
): Point[] {
  const rtol = options.rtol ?? 1e-8;
  const atol = options.atol ?? 1e-10;
  const maxSteps = options.maxSteps ?? 20000;
  const direction = tEnd >= t0 ? 1 : -1;
  let t = t0;
  let y = y0.slice();
  let h = direction * Math.min(Math.abs(tEnd - t0) / 10, 0.1) || direction * 1e-3;
  const points: Point[] = [{ t, y: y.slice() }];
  for (let n = 0; n < maxSteps && (tEnd - t) * direction > 1e-14 * Math.max(1, Math.abs(tEnd)); n++) {
    if ((t + h - tEnd) * direction > 0) h = tEnd - t;
    const k: number[][] = [];
    for (let s = 0; s < 7; s++) {
      let ys = y;
      for (let j = 0; j < s; j++) ys = axpy(ys, h * A[s][j], k[j]);
      k.push(f(t + C[s] * h, ys));
    }
    let y5 = y;
    let y4 = y;
    for (let s = 0; s < 7; s++) {
      y5 = axpy(y5, h * B5[s], k[s]);
      y4 = axpy(y4, h * B4[s], k[s]);
    }
    let error = 0;
    for (let i = 0; i < y.length; i++) {
      const scale = atol + rtol * Math.max(Math.abs(y[i]), Math.abs(y5[i]));
      error = Math.max(error, Math.abs(y5[i] - y4[i]) / scale);
    }
    if (!Number.isFinite(error)) break;
    if (error <= 1) {
      t += h;
      y = y5;
      const point = { t, y: y.slice() };
      points.push(point);
      if (options.stop?.(point)) break;
    }
    h *= Math.min(5, Math.max(0.2, 0.9 * (error === 0 ? 5 : error ** -0.2)));
  }
  return points;
}
