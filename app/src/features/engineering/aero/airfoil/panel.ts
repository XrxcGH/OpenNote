// The linear-strength vortex panel method, as set out by Kuethe and Chow. The vortex strength varies linearly along
// each flat panel and is continuous from panel to panel. The flow is tangent to the surface at each panel's midpoint,
// and the Kutta condition γ₁ + γ_{N+1} = 0 makes the flow leave the trailing edge smoothly. Strengths are in units
// of 2π V∞. Lift comes from the circulation (Kutta-Joukowski); integrating the pressures checks it.
import { AeroError, luSolve } from '../common';
import type { XY } from '../common';

export interface PanelResult {
  readonly panels: number;
  /** Lift coefficient from the circulation, and from integrating the pressures. */
  readonly cl: number;
  readonly clPressure: number;
  /** Moment coefficient about the reference point (the quarter chord), nose up positive. */
  readonly cm: number;
  /** Each panel's midpoint and pressure coefficient, in node order. */
  readonly mid: readonly XY[];
  readonly cp: readonly number[];
  /** Where the surface speed changes sign: the stagnation point, and whether it is on the lower surface. */
  readonly stagnation?: { readonly x: number; readonly y: number; readonly lower: boolean };
  readonly cpMin: number;
  readonly cpMinAt: number;
}

interface Influence {
  readonly cn1: number;
  readonly cn2: number;
  readonly ct1: number;
  readonly ct2: number;
}

interface Panels {
  readonly x: number[];
  readonly y: number[];
  readonly s: number[];
  readonly theta: number[];
}

function geometry(X: readonly number[], Y: readonly number[]): Panels {
  const n = X.length - 1;
  const out: Panels = { x: [], y: [], s: [], theta: [] };
  for (let j = 0; j < n; j += 1) {
    const [dx, dy] = [X[j + 1]! - X[j]!, Y[j + 1]! - Y[j]!];
    out.x.push((X[j]! + X[j + 1]!) / 2);
    out.y.push((Y[j]! + Y[j + 1]!) / 2);
    out.s.push(Math.hypot(dx, dy));
    out.theta.push(Math.atan2(dy, dx));
  }
  if (out.s.some((s) => !(s > 1e-12))) throw new AeroError('panelDegenerate');
  return out;
}

/** The normal and tangential velocity at midpoint i from panel j's two end strengths. */
function influence(P: Panels, X: readonly number[], Y: readonly number[], i: number, j: number): Influence {
  if (i === j) return { cn1: -1, cn2: 1, ct1: Math.PI / 2, ct2: Math.PI / 2 };
  const [dx, dy] = [P.x[i]! - X[j]!, P.y[i]! - Y[j]!];
  const [ti, tj, S] = [P.theta[i]!, P.theta[j]!, P.s[j]!];
  const A = -dx * Math.cos(tj) - dy * Math.sin(tj);
  const B = dx * dx + dy * dy;
  const C = Math.sin(ti - tj);
  const D = Math.cos(ti - tj);
  const E = dx * Math.sin(tj) - dy * Math.cos(tj);
  const F = Math.log(1 + (S * (S + 2 * A)) / B);
  const G = Math.atan2(E * S, B + A * S);
  const Pp = dx * Math.sin(ti - 2 * tj) + dy * Math.cos(ti - 2 * tj);
  const Q = dx * Math.cos(ti - 2 * tj) - dy * Math.sin(ti - 2 * tj);
  const cn2 = D + (0.5 * Q * F) / S - ((A * C + D * E) * G) / S;
  const ct2 = C + (0.5 * Pp * F) / S + ((A * D - C * E) * G) / S;
  return { cn1: 0.5 * D * F + C * G - cn2, cn2, ct1: 0.5 * C * F - D * G - ct2, ct2 };
}

/** The node strengths and the tangential speed at each midpoint, over V∞. */
function solve(P: Panels, X: readonly number[], Y: readonly number[], alpha: number) {
  const n = P.x.length;
  const An: number[][] = [];
  const At: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    const an = new Array<number>(n + 1).fill(0);
    const at = new Array<number>(n + 1).fill(0);
    for (let j = 0; j < n; j += 1) {
      const k = influence(P, X, Y, i, j);
      an[j] = an[j]! + k.cn1;
      an[j + 1] = an[j + 1]! + k.cn2;
      at[j] = at[j]! + k.ct1;
      at[j + 1] = at[j + 1]! + k.ct2;
    }
    An.push(an);
    At.push(at);
  }
  const kutta = new Array<number>(n + 1).fill(0);
  kutta[0] = 1;
  kutta[n] = 1;
  An.push(kutta);
  const gamma = luSolve(An, [...P.theta.map((t) => Math.sin(t - alpha)), 0]);
  const vt = At.map((row, i) => Math.cos(P.theta[i]! - alpha) + row.reduce((sum, a, j) => sum + a * gamma[j]!, 0));
  return { gamma, vt };
}

/** Linear interpolation of where the surface speed passes through zero, nearest the nose. */
function stagnation(P: Panels, vt: readonly number[]): PanelResult['stagnation'] {
  let best: PanelResult['stagnation'];
  let bestX = Infinity;
  for (let i = 0; i + 1 < vt.length; i += 1) {
    const [a, b] = [vt[i]!, vt[i + 1]!];
    if (a * b > 0 || a === b) continue;
    const w = a / (a - b);
    const x = P.x[i]! + w * (P.x[i + 1]! - P.x[i]!);
    if (x < bestX) {
      bestX = x;
      best = { x, y: P.y[i]! + w * (P.y[i + 1]! - P.y[i]!), lower: i + 1 <= vt.length / 2 };
    }
  }
  return best;
}

/**
 * Pressures and forces on the closed outline through the nodes (X, Y), which run clockwise from the trailing edge
 * along the lower surface. `chord` and `ref` (the moment point on the chord line) are in the nodes' units.
 */
export function vortexPanel(
  X: readonly number[],
  Y: readonly number[],
  alpha: number,
  chord = 1,
  ref: XY = { x: 0.25, y: 0 },
): PanelResult {
  const P = geometry(X, Y);
  const n = P.x.length;
  const { gamma, vt } = solve(P, X, Y, alpha);
  const cp = vt.map((v) => 1 - v * v);
  let circulation = 0;
  let [fx, fy, moment] = [0, 0, 0];
  for (let j = 0; j < n; j += 1) {
    circulation += ((gamma[j]! + gamma[j + 1]!) / 2) * P.s[j]!;
    // For a clockwise outline the outward normal is the panel direction turned left; the pressure pushes inward.
    const [nx, ny] = [-Math.sin(P.theta[j]!), Math.cos(P.theta[j]!)];
    const [dfx, dfy] = [-cp[j]! * P.s[j]! * nx, -cp[j]! * P.s[j]! * ny];
    fx += dfx;
    fy += dfy;
    moment -= (P.x[j]! - ref.x) * dfy - (P.y[j]! - ref.y) * dfx;
  }
  let k = 0;
  cp.forEach((c, i) => {
    if (c < cp[k]!) k = i;
  });
  const stag = stagnation(P, vt);
  return {
    panels: n,
    cl: (4 * Math.PI * circulation) / chord,
    clPressure: (fy * Math.cos(alpha) - fx * Math.sin(alpha)) / chord,
    cm: moment / (chord * chord),
    mid: P.x.map((x, i) => ({ x, y: P.y[i]! })),
    cp,
    ...(stag ? { stagnation: stag } : {}),
    cpMin: cp[k]!,
    cpMinAt: P.x[k]!,
  };
}
