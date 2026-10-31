// Ordinary differential equations for the kits. dopri45 is the Dormand-Prince 5(4) pair (Dormand and Prince 1980)
// with error control. Output between steps uses the continuous extension of Hairer, Nørsett and Wanner (Solving
// ODEs I, section II.6). Events g(t, y) = 0 are found on the continuous solution by Brent's method and may stop the
// run. rk4 is the classic fixed-step method, for showing a hand calculation.
import { NumError } from './errors';
import { brent } from './roots';

export type OdeFunction = (t: number, y: readonly number[]) => number[];

export interface OdeEvent {
  g(t: number, y: readonly number[]): number;
  /** +1 for g rising through zero, -1 for falling, 0 (the default) for either. */
  direction?: -1 | 0 | 1;
  /** Whether the solution stops at the event. */
  terminal?: boolean;
}

export interface OdeOptions {
  rtol?: number;
  atol?: number;
  maxSteps?: number;
  /** The first step; chosen automatically when left out. */
  h0?: number;
  /** The largest step, so plots of slow solutions stay smooth. */
  hmax?: number;
  events?: readonly OdeEvent[];
}

export interface OdeHit {
  /** The index of the event in options.events. */
  index: number;
  t: number;
  y: number[];
}

export interface OdeSolution {
  /** The accepted step ends, first t0. */
  t: number[];
  y: number[][];
  events: OdeHit[];
  /** 'done' at t1, 'event' at a terminal event, 'maxSteps' when it ran out of steps. */
  status: 'done' | 'event' | 'maxSteps';
  steps: number;
  rejected: number;
  evaluations: number;
  /** The solution at any t between t0 and the last t, from the continuous extension. */
  at(t: number): number[];
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
/** The 5th-order weights minus the embedded 4th-order weights. */
const E = [71 / 57600, 0, -71 / 16695, 71 / 1920, -17253 / 339200, 22 / 525, -1 / 40];
/** The continuous extension's coefficients. */
const D = [
  -12715105075 / 11282082432,
  0,
  87487479700 / 32700410799,
  -10690763975 / 1880347072,
  701980252875 / 199316789632,
  -1453857185 / 822651844,
  69997945 / 29380423,
];

interface Segment {
  t0: number;
  h: number;
  /** The five coefficient vectors of the continuous extension. */
  r: number[][];
}

function interpolate(seg: Segment, t: number): number[] {
  const theta = (t - seg.t0) / seg.h;
  const theta1 = 1 - theta;
  const [r1, r2, r3, r4, r5] = seg.r;
  return r1.map((_, i) => r1[i] + theta * (r2[i] + theta1 * (r3[i] + theta * (r4[i] + theta1 * r5[i]))));
}

/** One Dormand-Prince step: the stages, the new y, and the error estimate's terms. */
function step(f: OdeFunction, t: number, y: readonly number[], h: number, k1: readonly number[]) {
  const k: number[][] = [[...k1]];
  for (let s = 1; s < 7; s += 1) {
    const ys = y.map((yi, i) => yi + h * A[s].reduce((sum, a, j) => sum + a * k[j][i], 0));
    k.push(f(t + C[s] * h, ys));
  }
  const y1 = y.map((yi, i) => yi + h * A[6].reduce((sum, a, j) => sum + a * k[j][i], 0));
  const err = y.map((_, i) => h * E.reduce((sum, e, j) => sum + e * k[j][i], 0));
  return { k, y1, err };
}

function errorNorm(err: readonly number[], y0: readonly number[], y1: readonly number[], rtol: number, atol: number) {
  let sum = 0;
  err.forEach((e, i) => {
    const sc = atol + rtol * Math.max(Math.abs(y0[i]), Math.abs(y1[i]));
    sum += (e / sc) ** 2;
  });
  return Math.sqrt(sum / err.length);
}

/** Hairer's starting step: small enough that one Euler step changes f by about 1%. */
function firstStep(f: OdeFunction, t0: number, y0: readonly number[], f0: readonly number[], dir: number, tol: number) {
  const sc = y0.map((yi) => tol + tol * Math.abs(yi));
  const rms = (v: readonly number[]) => Math.sqrt(v.reduce((s, x, i) => s + (x / sc[i]) ** 2, 0) / v.length);
  const d0 = rms(y0);
  const d1 = rms(f0);
  const h0 = d0 < 1e-5 || d1 < 1e-5 ? 1e-6 : (0.01 * d0) / d1;
  const f1 = f(
    t0 + dir * h0,
    y0.map((yi, i) => yi + dir * h0 * f0[i]),
  );
  const d2 = rms(f1.map((v, i) => v - f0[i])) / h0;
  const h1 = Math.max(d1, d2) <= 1e-15 ? Math.max(1e-6, h0 * 1e-3) : (0.01 / Math.max(d1, d2)) ** (1 / 5);
  return Math.min(100 * h0, h1);
}

/** Integrates y' = f(t, y) from t0 to t1 (either direction) by Dormand-Prince 5(4). */
export function dopri45(
  f: OdeFunction,
  tspan: readonly [number, number],
  y0: readonly number[],
  options: OdeOptions = {},
): OdeSolution {
  const [t0, t1] = tspan;
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || !y0.every(Number.isFinite)) throw new NumError('notFinite');
  const rtol = options.rtol ?? 1e-6;
  const atol = options.atol ?? rtol * 1e-3;
  const maxSteps = options.maxSteps ?? 100000;
  const dir = t1 >= t0 ? 1 : -1;
  const hmax = options.hmax ?? Math.abs(t1 - t0);
  const out: OdeSolution = {
    t: [t0],
    y: [[...y0]],
    events: [],
    status: 'done',
    steps: 0,
    rejected: 0,
    evaluations: 1,
    at: () => [],
  };
  const segments: Segment[] = [];
  out.at = (t) => evaluateAt(segments, out, t);
  if (t0 === t1) return out;
  let t = t0;
  let y = [...y0];
  let k1 = f(t, y);
  let h = Math.min(hmax, options.h0 ?? firstStep(f, t, y, k1, dir, rtol));
  out.evaluations += 2;
  const events = options.events ?? [];
  let gPrev = events.map((ev) => ev.g(t, y));
  while (dir * (t1 - t) > 0) {
    if (out.steps + out.rejected >= maxSteps) {
      out.status = 'maxSteps';
      return out;
    }
    h = Math.min(h, Math.abs(t1 - t), hmax);
    if (h <= 16 * 2 ** -52 * Math.abs(t)) throw new NumError('noConvergence', `step size underflow at t = ${t}`);
    const { k, y1, err } = step(f, t, y, dir * h, k1);
    out.evaluations += 6;
    const errNorm = errorNorm(err, y, y1, rtol, atol);
    if (!Number.isFinite(errNorm)) throw new NumError('notFinite', `at t = ${t}`);
    const factor = errNorm === 0 ? 5 : Math.min(5, Math.max(0.2, 0.9 * errNorm ** -0.2));
    if (errNorm > 1) {
      out.rejected += 1;
      h *= Math.max(0.2, factor);
      continue;
    }
    const seg = segmentOf(t, dir * h, y, y1, k);
    segments.push(seg);
    const tNew = dir * (t1 - (t + dir * h)) <= 0 ? t1 : t + dir * h;
    const stopAt = findEvents(events, gPrev, seg, tNew, out);
    out.steps += 1;
    if (stopAt !== null) {
      out.t.push(stopAt.t);
      out.y.push(stopAt.y);
      out.status = 'event';
      return out;
    }
    t = tNew;
    y = y1;
    k1 = k[6];
    gPrev = events.map((ev) => ev.g(t, y));
    out.t.push(t);
    out.y.push([...y]);
    h *= factor;
  }
  return out;
}

function segmentOf(
  t: number,
  h: number,
  y0: readonly number[],
  y1: readonly number[],
  k: readonly number[][],
): Segment {
  const ydiff = y1.map((v, i) => v - y0[i]);
  const bspl = k[0].map((v, i) => h * v - ydiff[i]);
  return {
    t0: t,
    h,
    r: [
      [...y0],
      ydiff,
      bspl,
      ydiff.map((v, i) => v - h * k[6][i] - bspl[i]),
      y0.map((_, i) => h * D.reduce((sum, d, j) => sum + d * k[j][i], 0)),
    ],
  };
}

/** Records the events in this step; returns the first terminal one, or null. */
function findEvents(
  events: readonly OdeEvent[],
  gPrev: number[],
  seg: Segment,
  tEnd: number,
  out: OdeSolution,
): OdeHit | null {
  const hits: OdeHit[] = [];
  events.forEach((ev, index) => {
    const g0 = gPrev[index];
    const g1 = ev.g(tEnd, interpolate(seg, tEnd));
    const rising = g0 < 0 && g1 >= 0;
    const falling = g0 > 0 && g1 <= 0;
    const dirOk = (ev.direction ?? 0) === 0 ? rising || falling : ev.direction === 1 ? rising : falling;
    if (!dirOk) return;
    const g = (tt: number) => ev.g(tt, interpolate(seg, tt));
    const root = brent(g, seg.t0, tEnd, 1e-14 * Math.max(1, Math.abs(tEnd)));
    hits.push({ index, t: root.x, y: interpolate(seg, root.x) });
  });
  hits.sort((a, b) => (a.t - b.t) * Math.sign(seg.h));
  for (const hit of hits) {
    out.events.push(hit);
    if (events[hit.index].terminal) return hit;
  }
  return null;
}

function evaluateAt(segments: readonly Segment[], out: OdeSolution, t: number): number[] {
  if (segments.length === 0) return [...out.y[0]];
  const dir = Math.sign(segments[0].h);
  const last = out.t[out.t.length - 1];
  if (dir * (t - out.t[0]) < 0 || dir * (t - last) > 0) throw new NumError('domain', 'outside the solved interval');
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (dir * (t - segments[mid].t0) >= 0) lo = mid;
    else hi = mid - 1;
  }
  return interpolate(segments[lo], t);
}

/** The classic fourth-order Runge-Kutta method with `steps` equal steps; returns every step. */
export function rk4(
  f: OdeFunction,
  tspan: readonly [number, number],
  y0: readonly number[],
  steps: number,
): { t: number[]; y: number[][] } {
  if (!(steps >= 1) || !Number.isInteger(steps))
    throw new NumError('domain', 'the number of steps must be a whole number');
  const [t0, t1] = tspan;
  const h = (t1 - t0) / steps;
  const t = [t0];
  const y = [[...y0]];
  let yi = [...y0];
  for (let n = 0; n < steps; n += 1) {
    const tn = t0 + n * h;
    const k1 = f(tn, yi);
    const k2 = f(
      tn + h / 2,
      yi.map((v, i) => v + (h / 2) * k1[i]),
    );
    const k3 = f(
      tn + h / 2,
      yi.map((v, i) => v + (h / 2) * k2[i]),
    );
    const k4 = f(
      tn + h,
      yi.map((v, i) => v + h * k3[i]),
    );
    yi = yi.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    t.push(t0 + (n + 1) * h);
    y.push([...yi]);
  }
  return { t, y };
}
