// Three additions to the phase-plane analysis: the fundamental matrix e^(At) in closed form, the trace-determinant
// plane, and limit cycles of a nonlinear system found by a return map on a section through an equilibrium.
import { fmt } from '../numeric';
import { step, type KitStep } from '../types';
import type { Mat } from '../dense';

type Pair = [number, number];

const tidy = (v: number) => (Math.abs(v) < 1e-12 ? 0 : v);
const matrixLatex = (m: readonly (readonly string[])[]) =>
  `\\begin{pmatrix}${m.map((r) => r.join('&')).join('\\\\')}\\end{pmatrix}`;
const numbersLatex = (m: Mat) => matrixLatex(m.map((r) => r.map((v) => fmt(tidy(v), 6))));

export interface Fundamental {
  /** e^(At) as LaTeX, written with the eigenvalues. */
  latex: string;
  /** The same matrix evaluated at a time t. */
  at: (t: number) => Mat;
  step: KitStep;
}

/** Phi(t) = e^(At) for A = [[a, b], [c, d]], in closed form for each kind of eigenvalue, not by a series. */
export function fundamentalMatrix(a: number, b: number, c: number, d: number): Fundamental {
  const trace = a + d;
  const det = a * d - b * c;
  const disc = trace * trace - 4 * det;
  const scale = Math.max(1, Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d)) ** 2;
  const minus = (lambda: number): Mat => [
    [a - lambda, b],
    [c, d - lambda],
  ];
  const lin = (m: Mat, k: number): Mat => m.map((r) => r.map((v) => v * k));
  const sum = (x: Mat, y: Mat): Mat => x.map((r, i) => r.map((v, j) => v + y[i][j]));
  const identity: Mat = [
    [1, 0],
    [0, 1],
  ];
  const wrap = (latex: string, at: (t: number) => Mat): Fundamental => ({
    latex: `e^{At}=${latex}`,
    at,
    step: step('odeFundamental', `e^{At}=${latex}`),
  });
  if (Math.abs(disc) <= 1e-12 * scale) {
    // One repeated eigenvalue: (A - lambda I)^2 = 0, so the series stops after two terms.
    const lambda = trace / 2;
    const N = minus(lambda);
    const nilpotent = N.flat().every((v) => Math.abs(v) < 1e-12 * Math.sqrt(scale));
    const e = `e^{${fmt(lambda, 6)}t}`;
    if (nilpotent)
      return wrap(
        `${e}${matrixLatex([
          ['1', '0'],
          ['0', '1'],
        ])}`,
        (t) => lin(identity, Math.exp(lambda * t)),
      );
    return wrap(`${e}\\left(I+t${numbersLatex(N)}\\right)`, (t) => lin(sum(identity, lin(N, t)), Math.exp(lambda * t)));
  }
  if (disc > 0) {
    // Real, distinct: e^(At) = E1 e^(l1 t) + E2 e^(l2 t) with the projections E1 = (A - l2 I) / (l1 - l2).
    const root = Math.sqrt(disc);
    const [l1, l2] = [(trace + root) / 2, (trace - root) / 2];
    const E1 = lin(minus(l2), 1 / (l1 - l2));
    const E2 = lin(minus(l1), 1 / (l2 - l1));
    return wrap(`${numbersLatex(E1)}e^{${fmt(l1, 6)}t}+${numbersLatex(E2)}e^{${fmt(l2, 6)}t}`, (t) =>
      sum(lin(E1, Math.exp(l1 * t)), lin(E2, Math.exp(l2 * t))),
    );
  }
  // Complex alpha +- i beta: (A - alpha I)^2 = -beta^2 I, so e^(At) = e^(alpha t)(cos(beta t) I + sin(beta t) / beta (A - alpha I)).
  const alpha = trace / 2;
  const beta = Math.sqrt(-disc) / 2;
  const N = minus(alpha);
  const cs = `\\cos ${fmt(beta, 6)}t`;
  const sn = `\\frac{\\sin ${fmt(beta, 6)}t}{${fmt(beta, 6)}}`;
  return wrap(`e^{${fmt(alpha, 6)}t}\\left(${cs}\\,I+${sn}${numbersLatex(N)}\\right)`, (t) =>
    lin(sum(lin(identity, Math.cos(beta * t)), lin(N, Math.sin(beta * t) / beta)), Math.exp(alpha * t)),
  );
}

export interface TraceDetPlane {
  /** det = trace^2 / 4, which separates nodes from spirals. */
  parabola: Pair[];
  /** The two axes: det = 0 (saddles below, the boundary of stability) and trace = 0 (centers on the positive side). */
  axes: Pair[][];
  point: Pair;
}

/** The trace-determinant plane around the point (trace, det): the parabola, the axes, and the point itself. */
export function traceDeterminant(trace: number, det: number): TraceDetPlane {
  const reach = Math.max(2, Math.abs(trace) * 1.4, Math.sqrt(Math.abs(det)) * 2.8);
  const top = Math.max((reach * reach) / 4, Math.abs(det) * 1.4, 1);
  const parabola = Array.from({ length: 81 }, (_, k): Pair => {
    const x = -reach + (2 * reach * k) / 80;
    return [x, (x * x) / 4];
  });
  return {
    parabola,
    axes: [
      [
        [-reach, 0],
        [reach, 0],
      ],
      [
        [0, -top],
        [0, top],
      ],
    ],
    point: [trace, det],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Limit cycles
// ---------------------------------------------------------------------------------------------------------------

export interface LimitCycle {
  /** Where the orbit crosses the section y = y0, x > x0 through the equilibrium (x0, y0). */
  crossing: number;
  period: number;
  stable: boolean;
  around: Pair;
  /** One turn of the orbit. */
  path: Pair[];
}

type Rhs = (x: number, y: number) => Pair;

/** One fixed RK4 step. */
function rk4(f: Rhs, p: Pair, h: number): Pair {
  const k1 = f(p[0], p[1]);
  const k2 = f(p[0] + (h / 2) * k1[0], p[1] + (h / 2) * k1[1]);
  const k3 = f(p[0] + (h / 2) * k2[0], p[1] + (h / 2) * k2[1]);
  const k4 = f(p[0] + h * k3[0], p[1] + h * k3[1]);
  return [
    p[0] + (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
    p[1] + (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
  ];
}

/** The crossing of y = y0 inside one step, by a cubic Hermite interpolation: the fraction of the step, and the point. */
function crossing(p0: Pair, p1: Pair, f0: Pair, f1: Pair, h: number, y0: number): { theta: number; at: Pair } {
  const hermite = (th: number): Pair => {
    const h00 = 2 * th ** 3 - 3 * th ** 2 + 1;
    const h10 = th ** 3 - 2 * th ** 2 + th;
    const h01 = -2 * th ** 3 + 3 * th ** 2;
    const h11 = th ** 3 - th ** 2;
    return [0, 1].map((i) => h00 * p0[i] + h10 * h * f0[i] + h01 * p1[i] + h11 * h * f1[i]) as Pair;
  };
  let lo = 0;
  let hi = 1;
  const sign = Math.sign(p1[1] - y0);
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (Math.sign(hermite(mid)[1] - y0) === sign) hi = mid;
    else lo = mid;
  }
  return { theta: (lo + hi) / 2, at: hermite((lo + hi) / 2) };
}

interface Run {
  xs: number[];
  times: number[];
  /** The path of the last full turn. */
  turn: Pair[];
}

/** Integrates from `start` (forward when direction is 1) and records where it crosses the section y = y0, x > x0. */
function returns(f: Rhs, start: Pair, eq: Pair, direction: 1 | -1, h: number, limit: number): Run {
  const g: Rhs = (x, y) => {
    const v = f(x, y);
    return [direction * v[0], direction * v[1]];
  };
  const run: Run = { xs: [], times: [], turn: [] };
  let p = start;
  let t = 0;
  let sign = 0;
  let trail: Pair[] = [p];
  for (let n = 0; n < limit && run.xs.length < 60; n++) {
    const next = rk4(g, p, h);
    if (!Number.isFinite(next[0]) || !Number.isFinite(next[1]) || Math.hypot(next[0] - eq[0], next[1] - eq[1]) > 1e4)
      break;
    const side = Math.sign(next[1] - eq[1]);
    if (sign !== 0 && side !== sign && side !== 0) {
      const { theta, at } = crossing(p, next, g(p[0], p[1]), g(next[0], next[1]), h, eq[1]);
      // Count only crossings on the right of the equilibrium: an orbit round it crosses that ray one way only.
      if (at[0] > eq[0]) {
        run.xs.push(at[0]);
        run.times.push(t + theta * h);
        run.turn = [...trail, at];
        trail = [at];
        if (settled(run, eq) !== null) break;
      }
    }
    if (side !== 0) sign = side;
    p = next;
    t += h;
    if (n % 4 === 0 && trail.length < 4000) trail.push(p);
  }
  return run;
}

/** Whether the return map has settled on a value: the last crossings agree. */
function settled(run: Run, eq: Pair): number | null {
  const n = run.xs.length;
  if (n < 6) return null;
  const [a, b, c] = run.xs.slice(-3);
  const size = 1 + Math.abs(c - eq[0]);
  if (Math.abs(b - a) > 1e-7 * size || Math.abs(c - b) > 1e-7 * size) return null;
  // A return map that settles at the equilibrium itself is a spiral into it, not a cycle.
  if (c - eq[0] < 1e-3 * size) return null;
  return c;
}

/**
 * Limit cycles around an equilibrium. A stable cycle attracts a start near the equilibrium and a start well outside;
 * an unstable one attracts them backward in time. Starts at two different distances must land on the same crossing:
 * a center has a different closed orbit through every start, and its return map is the identity, not a cycle.
 */
export function limitCyclesAround(f: Rhs, eq: Pair, reach: number): LimitCycle[] {
  const found: LimitCycle[] = [];
  const h = 0.005;
  const limit = 400000;
  const tries: { starts: Pair[]; direction: 1 | -1 }[] = [
    {
      starts: [
        [eq[0] + 0.04 * reach, eq[1]],
        [eq[0] + 0.5 * reach, eq[1]],
      ],
      direction: 1,
    },
    {
      starts: [
        [eq[0] + 0.05 * reach, eq[1]],
        [eq[0] + 0.12 * reach, eq[1]],
      ],
      direction: -1,
    },
  ];
  for (const { starts, direction } of tries) {
    const runs = starts.map((s) => returns(f, s, eq, direction, h, limit));
    const crossings = runs.map((r) => settled(r, eq));
    if (crossings.some((v) => v === null)) continue;
    const [u, v] = crossings as number[];
    if (Math.abs(u - v) > 1e-5 * (1 + Math.abs(u))) continue;
    const run = runs[0];
    const period = run.times[run.times.length - 1] - run.times[run.times.length - 2];
    if (found.some((c) => Math.abs(c.crossing - u) < 1e-5 * (1 + Math.abs(u)))) continue;
    found.push({ crossing: u, period, stable: direction === 1, around: eq, path: run.turn });
  }
  return found;
}

export const cycleStep = (cycle: LimitCycle): KitStep =>
  step('odeLimitCycle', undefined, {
    at: `(${fmt(cycle.around[0], 6)}, ${fmt(cycle.around[1], 6)})`,
    x: fmt(cycle.crossing, 6),
    period: fmt(cycle.period, 6),
    $stability: cycle.stable ? 'kitMath.odes.cycleStable' : 'kitMath.odes.cycleUnstable',
  });
