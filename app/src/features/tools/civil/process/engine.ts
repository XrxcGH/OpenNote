// Material balances and separations: the methods behind the calculations in ./calcs. Flows are in any consistent
// unit, pressures in bar, temperatures in kelvin (Antoine constants in the NIST form, log₁₀ P/bar = A - B/(T + C)).
import { evaluate, freeNames, tryParse } from '../../../../core/expr';
import { brent, solveLinear } from '../core/num';
import { CivilError, need } from '../core/types';

// ---------------------------------------------------------------------------------------------------------------
// Mixing and simple units

/** Streams of (flow, fraction of one component) mixed into one. */
export function mix(streams: readonly (readonly number[])[]): { F: number; x: number; parts: number[] } {
  need(streams.length >= 2, 'process.errors.twoStreams');
  for (const [F, x] of streams) {
    need(F! >= 0, 'errors.nonNegative', { name: '~process.f.flowCol' });
    need(x! >= 0 && x! <= 1, 'process.errors.fraction');
  }
  const F = streams.reduce((s, r) => s + r[0]!, 0);
  need(F > 0, 'errors.positive', { name: '~process.f.flowCol' });
  const parts = streams.map((r) => r[0]! * r[1]!);
  return { F, x: parts.reduce((s, v) => s + v, 0) / F, parts };
}

/** A separator: each component's feed flow and the fraction of it sent to the top. */
export function separate(rows: readonly (readonly number[])[]) {
  need(rows.length >= 1, 'errors.noRows');
  const out = rows.map(([f, s]) => {
    need(f! >= 0, 'errors.nonNegative', { name: '~process.f.flowCol' });
    need(s! >= 0 && s! <= 1, 'process.errors.fraction');
    return { feed: f!, top: f! * s!, bottom: f! * (1 - s!) };
  });
  const T = out.reduce((s, r) => s + r.top, 0);
  const B = out.reduce((s, r) => s + r.bottom, 0);
  return {
    rows: out,
    T,
    B,
    xTop: out.map((r) => (T > 0 ? r.top / T : 0)),
    xBottom: out.map((r) => (B > 0 ? r.bottom / B : 0)),
  };
}

/**
 * A reactor with recycle: fresh feed of A (and inert I), single-pass conversion x, a separator that returns the
 * fraction r of unreacted A and all the inert to the recycle, and a purge that bleeds the fraction p of the recycle.
 */
export function recycleLoop(FA: number, FI: number, x: number, r: number, p: number) {
  need(FA > 0, 'errors.positive', { name: '~process.f.FA' });
  need(FI >= 0, 'errors.nonNegative', { name: '~process.f.FI' });
  need(x > 0 && x <= 1, 'process.errors.conversion');
  need(r >= 0 && r <= 1 && p >= 0 && p <= 1, 'process.errors.fraction');
  need(FI === 0 || p > 0, 'process.errors.inertBuild');
  const loop = (1 - p) * r * (1 - x);
  const RA = FA / (1 - loop);
  const RI = FI > 0 ? FI / p : 0;
  const unreacted = RA * (1 - x);
  const toRecycleA = r * unreacted;
  const recycle = { A: (1 - p) * toRecycleA, I: (1 - p) * RI };
  const purge = { A: p * toRecycleA, I: p * RI };
  const product = unreacted - toRecycleA;
  const reacted = RA * x;
  return { RA, RI, recycle, purge, product, reacted, overall: reacted / FA };
}

// ---------------------------------------------------------------------------------------------------------------
// Linear balances typed as equations

/** Names core/expr reads as constants, so they are never unknowns. */
const CONSTANTS = new Set(['pi', 'e', 'tau', 'phi']);

export interface Balance {
  names: string[];
  A: number[][];
  b: number[];
  rank: number;
  dof: number;
  x: number[] | null;
  residual: number;
}

function rankOf(rows: readonly (readonly number[])[]): number {
  const a = rows.map((r) => [...r]);
  const m = a.length;
  const n = m ? a[0]!.length : 0;
  const scale = Math.max(1e-300, ...a.flat().map(Math.abs));
  let rank = 0;
  for (let col = 0; col < n && rank < m; col++) {
    let pivot = rank;
    for (let i = rank + 1; i < m; i++) if (Math.abs(a[i]![col]!) > Math.abs(a[pivot]![col]!)) pivot = i;
    if (Math.abs(a[pivot]![col]!) <= 1e-10 * scale) continue;
    [a[rank], a[pivot]] = [a[pivot]!, a[rank]!];
    for (let i = rank + 1; i < m; i++) {
      const f = a[i]![col]! / a[rank]![col]!;
      for (let j = col; j < n; j++) a[i]![j]! -= f * a[rank]![j]!;
    }
    rank++;
  }
  return rank;
}

/**
 * Reads equations such as "F1 + F2 = F3; 0.2*F1 + 0.5*F2 = 0.3*F3; F1 = 100", one per semicolon or line, finds the
 * unknowns, checks that each equation is linear in them, and solves when the degrees of freedom are 0.
 */
export function linearBalances(source: string): Balance {
  const equations = source
    .split(/[;\n]/)
    .map((e) => e.trim())
    .filter(Boolean);
  need(equations.length > 0, 'process.errors.noEquations');
  const sides = equations.map((eq, i) => {
    const parts = eq.split('=');
    need(parts.length === 2 && parts[0]!.trim() !== '' && parts[1]!.trim() !== '', 'process.errors.equation', {
      row: i + 1,
    });
    return [parts[0]!.trim(), parts[1]!.trim()] as const;
  });
  const names = new Set<string>();
  for (const [i, [l, r]] of sides.entries())
    for (const side of [l, r]) {
      const tree = tryParse(side);
      need(tree.ok, 'process.errors.equation', { row: i + 1 });
      for (const name of freeNames(tree.value)) if (!CONSTANTS.has(name)) names.add(name);
    }
  const list = [...names].sort();
  need(list.length > 0 && list.length <= 30, 'process.errors.unknowns');
  const residualAt = (i: number, values: readonly number[]) => {
    const variables = Object.fromEntries(list.map((name, j) => [name, values[j]!]));
    const [l, r] = sides[i]!;
    const a = evaluate(l, { variables });
    const b = evaluate(r, { variables });
    if (!a.ok || !b.ok) throw new CivilError('process.errors.equation', { row: i + 1 });
    return a.value - b.value;
  };
  const zero = list.map(() => 0);
  const A: number[][] = [];
  const b: number[] = [];
  sides.forEach((_, i) => {
    const c0 = residualAt(i, zero);
    const row = list.map(
      (_n, j) =>
        residualAt(
          i,
          list.map((_m, k) => (k === j ? 1 : 0)),
        ) - c0,
    );
    // Linear means the residual at another point is what the coefficients predict.
    const probe = list.map((_n, j) => 1.7 + 0.37 * j);
    const predicted = c0 + row.reduce((s, c, j) => s + c * probe[j]!, 0);
    const actual = residualAt(i, probe);
    need(Math.abs(actual - predicted) <= 1e-9 * Math.max(1, Math.abs(actual)), 'process.errors.nonlinear', {
      row: i + 1,
    });
    A.push(row);
    b.push(-c0);
  });
  const rank = rankOf(A);
  const augmented = rankOf(A.map((r, i) => [...r, b[i]!]));
  need(augmented === rank, 'process.errors.inconsistent');
  const dof = list.length - rank;
  let x: number[] | null = null;
  let residual = 0;
  if (dof === 0) {
    // Keep a set of independent rows, then solve the square system.
    const keep: number[] = [];
    for (let i = 0; i < A.length && keep.length < list.length; i++)
      if (rankOf([...keep.map((k) => A[k]!), A[i]!]) > keep.length) keep.push(i);
    x = solveLinear(
      keep.map((k) => A[k]!),
      keep.map((k) => b[k]!),
    );
    residual = Math.max(...A.map((r, i) => Math.abs(r.reduce((s, c, j) => s + c * x![j]!, 0) - b[i]!)));
  }
  return { names: list, A, b, rank, dof, x, residual };
}

// ---------------------------------------------------------------------------------------------------------------
// Energy balance with a reaction

export interface EnergyRow {
  nIn: number;
  nu: number;
  dHf: number;
  cp: number;
}

/**
 * The heat to add for a reaction of extent ξ, by the heat-of-formation path through 25 °C: Q = Σ n_out ĉp (T_out −
 * 298.15) − Σ n_in ĉp (T_in − 298.15) + ξ ΔH°r, with mean heat capacities.
 */
export function reactionHeat(rows: readonly EnergyRow[], xi: number, Tin: number, Tout: number) {
  need(rows.length >= 1, 'errors.noRows');
  need(Tin > 0 && Tout > 0, 'process.errors.kelvin');
  const out = rows.map((r) => r.nIn + r.nu * xi);
  for (const [i, n] of out.entries()) {
    need(rows[i]!.nIn >= 0, 'errors.nonNegative', { name: '~process.f.nInCol' });
    need(n >= -1e-12, 'process.errors.extent');
  }
  const dHr = rows.reduce((s, r) => s + r.nu * r.dHf, 0);
  const Href = 298.15;
  const sensibleIn = rows.reduce((s, r) => s + r.nIn * r.cp * (Tin - Href), 0) / 1000;
  const sensibleOut = rows.reduce((s, r, i) => s + out[i]! * r.cp * (Tout - Href), 0) / 1000;
  const Q = sensibleOut - sensibleIn + xi * dHr;
  return { out, dHr, sensibleIn, sensibleOut, Q };
}

// ---------------------------------------------------------------------------------------------------------------
// Vapor-liquid equilibrium

export interface Antoine {
  A: number;
  B: number;
  C: number;
}

/** Vapor pressure in bar from NIST-form Antoine constants, T in kelvin. */
export function antoine(c: Antoine, T: number): number {
  need(T + c.C > 0, 'process.errors.antoine');
  return 10 ** (c.A - c.B / (T + c.C));
}

export type ActivityModel =
  | { kind: 'ideal' }
  | { kind: 'margules'; A12: number; A21: number }
  | { kind: 'vanLaar'; A12: number; A21: number }
  | { kind: 'wilson'; L12: number; L21: number };

/** Activity coefficients of a binary at liquid mole fraction x₁. */
export function gammas(model: ActivityModel, x1: number): [number, number] {
  const x2 = 1 - x1;
  switch (model.kind) {
    case 'ideal':
      return [1, 1];
    case 'margules': {
      const { A12, A21 } = model;
      return [Math.exp(x2 * x2 * (A12 + 2 * (A21 - A12) * x1)), Math.exp(x1 * x1 * (A21 + 2 * (A12 - A21) * x2))];
    }
    case 'vanLaar': {
      const { A12, A21 } = model;
      if (A12 === 0 || A21 === 0) return [1, 1];
      const d = A12 * x1 + A21 * x2;
      return [Math.exp(A12 * ((A21 * x2) / d) ** 2), Math.exp(A21 * ((A12 * x1) / d) ** 2)];
    }
    case 'wilson': {
      const { L12, L21 } = model;
      need(L12 > 0 && L21 > 0, 'process.errors.wilson');
      const a = x1 + L12 * x2;
      const b = x2 + L21 * x1;
      const t = L12 / a - L21 / b;
      return [Math.exp(-Math.log(a) + x2 * t), Math.exp(-Math.log(b) - x1 * t)];
    }
  }
}

export interface Bubble {
  T: number;
  P: number;
  x1: number;
  y1: number;
  gamma: [number, number];
  Psat: [number, number];
}

/** Bubble point (liquid x₁ given) or dew point (vapor y₁ given), at fixed T (find P) or fixed P (find T). */
export function vlePoint(
  kind: 'bubble' | 'dew',
  fixed: 'T' | 'P',
  value: number,
  frac: number,
  c1: Antoine,
  c2: Antoine,
  model: ActivityModel,
): Bubble {
  need(frac >= 0 && frac <= 1, 'process.errors.fraction');
  need(value > 0, 'errors.positive', { name: fixed === 'T' ? '~process.f.T' : '~process.f.P' });
  const bubbleP = (T: number, x1: number) => {
    const [g1, g2] = gammas(model, x1);
    const P1 = antoine(c1, T);
    const P2 = antoine(c2, T);
    const P = x1 * g1 * P1 + (1 - x1) * g2 * P2;
    return { P, y1: (x1 * g1 * P1) / P, g: [g1, g2] as [number, number], Ps: [P1, P2] as [number, number] };
  };
  // At fixed T, find x₁ for a dew point; at fixed P, find T as well.
  const solveT = (f: (T: number) => number) => {
    const lo = Math.max(1, -Math.min(c1.C, c2.C) + 1);
    let a = lo;
    let b = lo + 50;
    for (let i = 0; i < 200 && f(a) * f(b) > 0; i++) {
      a = b;
      b += 25;
    }
    need(f(a) * f(b) <= 0, 'errors.noRoot');
    return brent(f, a, b, 1e-10);
  };
  if (kind === 'bubble') {
    const T = fixed === 'T' ? value : solveT((t) => bubbleP(t, frac).P - value);
    const r = bubbleP(T, frac);
    return { T, P: r.P, x1: frac, y1: r.y1, gamma: r.g, Psat: r.Ps };
  }
  // Dew: find x₁ (and T) so the bubble vapor equals y₁.
  const xAt = (T: number) => (frac <= 0 ? 0 : frac >= 1 ? 1 : brent((x) => bubbleP(T, x).y1 - frac, 0, 1, 1e-13));
  const T = fixed === 'T' ? value : solveT((t) => bubbleP(t, xAt(t)).P - value);
  const x1 = xAt(T);
  const r = bubbleP(T, x1);
  return { T, P: r.P, x1, y1: frac, gamma: r.g, Psat: r.Ps };
}

/** Rachford-Rice flash: vapor fraction V/F and the phase compositions from z and K. */
export function flash(z: readonly number[], K: readonly number[]) {
  need(z.length >= 2 && z.length === K.length, 'process.errors.flashRows');
  for (let i = 0; i < z.length; i++) {
    need(z[i]! >= 0, 'process.errors.fraction');
    need(K[i]! > 0, 'errors.positive', { name: '~process.f.KCol' });
  }
  const total = z.reduce((s, v) => s + v, 0);
  need(Math.abs(total - 1) <= 1e-6, 'process.errors.sumZ', { sum: total });
  const f = (V: number) => z.reduce((s, zi, i) => s + (zi * (K[i]! - 1)) / (1 + V * (K[i]! - 1)), 0);
  const f0 = f(0);
  const f1 = f(1);
  let V: number;
  let state: 'two' | 'liquid' | 'vapor';
  if (f0 <= 0) {
    V = 0;
    state = 'liquid';
  } else if (f1 >= 0) {
    V = 1;
    state = 'vapor';
  } else {
    // f falls from f(0) > 0 to f(1) < 0 and has no pole between, so the root is bracketed by [0, 1].
    V = brent(f, 0, 1, 1e-14);
    state = 'two';
  }
  const x = z.map((zi, i) => zi / (1 + V * (K[i]! - 1)));
  const y = x.map((xi, i) => K[i]! * xi);
  return { V, L: 1 - V, x, y, state };
}

// ---------------------------------------------------------------------------------------------------------------
// Distillation and absorption

/** Constant-volatility equilibrium y = αx/(1 + (α − 1)x) and its inverse. */
export const yEq = (alpha: number, x: number) => (alpha * x) / (1 + (alpha - 1) * x);
export const xEq = (alpha: number, y: number) => y / (alpha - (alpha - 1) * y);

export function fenske(alpha: number, xD: number, xB: number): number {
  need(alpha > 1, 'process.errors.alpha');
  need(xD > xB && xB > 0 && xD < 1, 'process.errors.purities');
  return Math.log((xD / (1 - xD)) * ((1 - xB) / xB)) / Math.log(alpha);
}

/** Binary Underwood: θ from α z/(α − θ) + (1 − z)/(1 − θ) = 1 − q, then R_min + 1 = α xD/(α − θ) + (1 − xD)/(1 − θ). */
export function underwood(alpha: number, xD: number, zF: number, q: number): { theta: number; Rmin: number } {
  need(alpha > 1, 'process.errors.alpha');
  need(zF > 0 && zF < 1 && xD > zF && xD < 1, 'process.errors.purities');
  const g = (th: number) => (alpha * zF) / (alpha - th) + (1 - zF) / (1 - th) - (1 - q);
  const theta = brent(g, 1 + 1e-12, alpha - 1e-12, 1e-14);
  const Rmin = (alpha * xD) / (alpha - theta) + (1 - xD) / (1 - theta) - 1;
  return { theta, Rmin };
}

/** The Gilliland correlation in Eduljee's (1975) form: Y = 0.75(1 − X^0.5668). */
export function gilliland(Nmin: number, Rmin: number, R: number): { X: number; Y: number; N: number } {
  need(R > Rmin, 'process.errors.reflux');
  const X = (R - Rmin) / (R + 1);
  const Y = 0.75 * (1 - X ** 0.5668);
  return { X, Y, N: (Nmin + Y) / (1 - Y) };
}

export interface McCabe {
  stages: { x: number; y: number }[];
  feedStage: number;
  N: number;
  /** The operating lines meet at (xi, yi). */
  xi: number;
  yi: number;
  Rmin: number;
}

/** McCabe-Thiele stepping from the top for a total condenser, with the q-line and the best feed stage. */
export function mccabeThiele(alpha: number, xD: number, xB: number, zF: number, q: number, R: number): McCabe {
  need(alpha > 1, 'process.errors.alpha');
  need(xB > 0 && xB < zF && zF < xD && xD < 1, 'process.errors.purities');
  const { Rmin } = underwood(alpha, xD, zF, q);
  need(R > Rmin * (1 + 1e-9), 'process.errors.reflux');
  // Rectifying line y = R/(R+1) x + xD/(R+1); q-line y = q/(q−1) x − zF/(q−1) (vertical when q = 1).
  const m = R / (R + 1);
  const c = xD / (R + 1);
  const xi = Math.abs(q - 1) < 1e-12 ? zF : (zF / (q - 1) + c) / (q / (q - 1) - m);
  const yi = m * xi + c;
  const sm = (yi - xB) / (xi - xB);
  const operating = (x: number, rectifying: boolean) => (rectifying ? m * x + c : xB + sm * (x - xB));
  const stages: { x: number; y: number }[] = [];
  let y = xD;
  let rectifying = true;
  let feedStage = 0;
  for (let k = 0; k < 500; k++) {
    const x = xEq(alpha, y);
    stages.push({ x, y });
    if (x <= xB) break;
    if (rectifying && x < xi) {
      rectifying = false;
      feedStage = stages.length;
    }
    y = operating(x, rectifying);
    need(k < 499, 'process.errors.pinch');
  }
  if (!feedStage) feedStage = stages.length;
  return { stages, feedStage, N: stages.length, xi, yi, Rmin };
}

/** Kremser stages for absorption (A = L/mG) or stripping (S = mV/L), dilute and linear y = m x. */
export function kremser(
  kind: 'absorb' | 'strip',
  factor: number,
  inlet: number,
  outlet: number,
  other: number,
  m: number,
): number {
  need(factor > 0, 'errors.positive', { name: '~process.f.factor' });
  need(m > 0, 'errors.positive', { name: '~process.f.m' });
  // Absorption: gas from y_in to y_out against liquid entering at x_in (other). Stripping: liquid from x_in to x_out
  // against gas entering at y_in (other).
  const top = kind === 'absorb' ? inlet - m * other : inlet - other / m;
  const bottom = kind === 'absorb' ? outlet - m * other : outlet - other / m;
  need(top > 0 && bottom > 0 && bottom < top, 'process.errors.kremser');
  if (Math.abs(factor - 1) < 1e-12) return top / bottom - 1;
  const value = Math.log((top / bottom) * (1 - 1 / factor) + 1 / factor) / Math.log(factor);
  need(Number.isFinite(value) && value > 0, 'process.errors.kremserLimit');
  return value;
}

/** The least L/G for a dilute absorber: the liquid leaves in equilibrium with the entering gas. */
export const minLiquid = (yIn: number, yOut: number, xIn: number, m: number): number => {
  need(yIn / m > xIn, 'process.errors.kremser');
  return (yIn - yOut) / (yIn / m - xIn);
};
