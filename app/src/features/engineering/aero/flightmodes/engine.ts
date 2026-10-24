// Aircraft dynamic modes from the linearized equations of motion x' = A x. Longitudinal state [u, w, q, theta];
// lateral-directional state [v, p, r, phi]. The characteristic polynomial comes from the Faddeev-LeVerrier
// recursion and its roots from Durand-Kerner iteration; each root is classified into a mode and compared with
// the classic two-state approximations.
import { AeroError, finite, num, step, tex, type AeroStep } from '../common';
import { polyRoots, type Complex } from '../num';

export type Axis = 'longitudinal' | 'lateral';
export type ModeId = 'shortPeriod' | 'phugoid' | 'dutchRoll' | 'roll' | 'spiral' | 'oscillation' | 'real';

export interface Derivatives {
  readonly Xu: number;
  readonly Xw: number;
  readonly Zu: number;
  readonly Zw: number;
  readonly Mu: number;
  readonly Mw: number;
  readonly Mq: number;
  readonly Mwdot: number;
  /** Trim speed, m/s, and pitch attitude, degrees. */
  readonly U0: number;
  readonly theta0: number;
}

export const G = 9.80665;

/** Longitudinal A matrix from dimensional derivatives (Zq and Zwdot neglected). */
export function longitudinalA(d: Derivatives): number[][] {
  Object.entries(d).forEach(([k, v]) => finite(v, k));
  if (d.U0 <= 0) throw new AeroError('notPositive', { name: 'U₀' });
  const th = (d.theta0 * Math.PI) / 180;
  return [
    [d.Xu, d.Xw, 0, -G * Math.cos(th)],
    [d.Zu, d.Zw, d.U0, -G * Math.sin(th)],
    [d.Mu + d.Mwdot * d.Zu, d.Mw + d.Mwdot * d.Zw, d.Mq + d.Mwdot * d.U0, -d.Mwdot * G * Math.sin(th)],
    [0, 0, 1, 0],
  ];
}

export interface Mode {
  readonly id: ModeId;
  readonly root: Complex;
  readonly wn: number;
  readonly zeta: number;
  /** Damped period, s (oscillatory modes). */
  readonly period?: number;
  /** Time to half amplitude (stable) or to double (unstable), s. */
  readonly halfOrDouble: number;
  readonly stable: boolean;
  /** Eigenvector magnitudes and phases (degrees), relative to the attitude state. */
  readonly shape: readonly { readonly magnitude: number; readonly phase: number }[];
}

export interface Approximation {
  readonly id: ModeId;
  readonly wn: number;
  readonly zeta: number;
  readonly root?: Complex;
}

export interface ModesResult {
  readonly A: readonly (readonly number[])[];
  /** det(sI - A) coefficients, s^4 first. */
  readonly characteristic: readonly number[];
  readonly modes: readonly Mode[];
  readonly approximations: readonly Approximation[];
  readonly steps: readonly AeroStep[];
}

const mmul = (a: number[][], b: number[][]) =>
  a.map((row) => b[0]!.map((_, j) => row.reduce((s, x, k) => s + x * b[k]![j]!, 0)));

/** Coefficients of det(sI - A), highest power first, by the Faddeev-LeVerrier recursion. */
export function characteristic(A: readonly (readonly number[])[]): number[] {
  const n = A.length;
  const Am = A.map((r) => [...r]);
  const I = Am.map((r, i) => r.map((_, j) => (i === j ? 1 : 0)));
  const c = [1];
  let M = Am.map((r) => r.map(() => 0));
  for (let k = 1; k <= n; k += 1) {
    M = mmul(Am, M).map((r, i) => r.map((x, j) => x + c[k - 1]! * I[i]![j]!));
    const AM = mmul(Am, M);
    c.push(-AM.reduce((s, r, i) => s + r[i]!, 0) / k);
  }
  return c;
}

type Cx = { re: number; im: number };
const cmul = (a: Cx, b: Cx): Cx => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const csub = (a: Cx, b: Cx): Cx => ({ re: a.re - b.re, im: a.im - b.im });
const cadd = (a: Cx, b: Cx): Cx => ({ re: a.re + b.re, im: a.im + b.im });
const cdiv = (a: Cx, b: Cx): Cx => {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};
const cabs = (a: Cx) => Math.hypot(a.re, a.im);

function det3(m: Cx[][]): Cx {
  const [a, b, c] = m as [Cx[], Cx[], Cx[]];
  const t1 = cmul(a[0]!, csub(cmul(b[1]!, c[2]!), cmul(b[2]!, c[1]!)));
  const t2 = cmul(a[1]!, csub(cmul(b[0]!, c[2]!), cmul(b[2]!, c[0]!)));
  const t3 = cmul(a[2]!, csub(cmul(b[0]!, c[1]!), cmul(b[1]!, c[0]!)));
  return cadd(csub(t1, t2), t3);
}

/** Eigenvector of a 4x4 matrix for eigenvalue s: the largest column of the adjugate of (A - sI). */
function eigenvector(A: readonly (readonly number[])[], s: Cx): Cx[] {
  const n = A.length;
  const B: Cx[][] = A.map((r, i) => r.map((x, j) => (i === j ? { re: x - s.re, im: -s.im } : { re: x, im: 0 })));
  let best: Cx[] = [];
  let bestNorm = -1;
  for (let col = 0; col < n; col += 1) {
    // Column col of adj(B) holds the cofactors C[col][i] for i = 0..n-1.
    const v: Cx[] = [];
    for (let i = 0; i < n; i += 1) {
      const minor = B.filter((_, r) => r !== col).map((row) => row.filter((_, k) => k !== i));
      const d = det3(minor);
      const sign = (i + col) % 2 === 0 ? 1 : -1;
      v.push({ re: sign * d.re, im: sign * d.im });
    }
    const norm = v.reduce((sum, z) => sum + cabs(z), 0);
    if (norm > bestNorm) {
      bestNorm = norm;
      best = v;
    }
  }
  const ref =
    cabs(best[3]!) > 1e-12 * bestNorm ? best[3]! : best.reduce((m, z) => (cabs(z) > cabs(m) ? z : m), best[0]!);
  return best.map((z) => cdiv(z, ref));
}

export function flightModes(input: { readonly axis: Axis; readonly A: readonly (readonly number[])[] }): ModesResult {
  const A = input.A;
  if (A.length !== 4 || A.some((r) => r.length !== 4)) throw new AeroError('matrixShape');
  A.forEach((r) => r.forEach((x) => finite(x, 'A')));
  const poly = characteristic(A);
  const all = polyRoots(poly);
  const pairs = all.filter((z) => z.im > 0).sort((a, b) => cabs(b) - cabs(a));
  const reals = all.filter((z) => z.im === 0).sort((a, b) => Math.abs(b.re) - Math.abs(a.re));
  const modes: Mode[] = [];
  const make = (id: ModeId, z: Complex): Mode => {
    const wn = cabs(z);
    const zeta = wn > 0 ? -z.re / wn : 0;
    const vec = eigenvector(A, z);
    return {
      id,
      root: z,
      wn,
      zeta: z.im === 0 ? (z.re < 0 ? 1 : -1) : zeta,
      ...(z.im > 0 ? { period: (2 * Math.PI) / z.im } : {}),
      halfOrDouble: z.re === 0 ? Infinity : Math.LN2 / Math.abs(z.re),
      stable: z.re < 0,
      shape: vec.map((v) => ({ magnitude: cabs(v), phase: (Math.atan2(v.im, v.re) * 180) / Math.PI })),
    };
  };
  if (input.axis === 'longitudinal') {
    pairs.forEach((z, i) =>
      modes.push(make(pairs.length === 2 ? (i === 0 ? 'shortPeriod' : 'phugoid') : 'oscillation', z)),
    );
    reals.forEach((z) => modes.push(make('real', z)));
  } else {
    pairs.forEach((z, i) => modes.push(make(i === 0 ? 'dutchRoll' : 'oscillation', z)));
    reals.forEach((z, i) => modes.push(make(reals.length === 2 ? (i === 0 ? 'roll' : 'spiral') : 'real', z)));
  }
  const approximations = input.axis === 'longitudinal' ? longApprox(A) : latApprox(A);
  const steps: AeroStep[] = [
    step(
      'fmMatrix',
      `A = \\begin{bmatrix} ${A.map((r) => r.map((x) => tex(x, 4)).join(' & ')).join(' \\\\ ')} \\end{bmatrix}`,
      { state: input.axis === 'longitudinal' ? '[u, w, q, θ]' : '[v, p, r, φ]' },
    ),
    step(
      'fmCharacteristic',
      `\\det(sI - A) = s^4 ${poly
        .slice(1)
        .map((c, i) => `${c < 0 ? '-' : '+'} ${tex(Math.abs(c), 5)}${['s^3', 's^2', 's', ''][i]}`)
        .join(' ')} = 0`,
    ),
    ...modes.map((m) =>
      step(
        m.root.im > 0 ? 'fmPair' : 'fmReal',
        `s = ${tex(m.root.re, 5)}${m.root.im > 0 ? ` \\pm ${tex(m.root.im, 5)}i` : ''}`,
        {
          mode: `@mode.${m.id}`,
          wn: num(m.wn, 5),
          zeta: num(m.zeta, 4),
          time: num(m.halfOrDouble, 4),
        },
      ),
    ),
  ];
  steps.push(step(input.axis === 'longitudinal' ? 'fmClassifyLong' : 'fmClassifyLat'));
  return { A, characteristic: poly, modes, approximations, steps };
}

function pairOf(a: number, b: number, c: number, d: number): { wn: number; zeta: number; root: Complex } {
  // Eigenvalues of [[a, b], [c, d]]: s^2 - (a + d) s + (ad - bc) = 0.
  const tr = a + d;
  const det = a * d - b * c;
  const wn = Math.sqrt(Math.max(det, 0));
  const zeta = wn > 0 ? -tr / (2 * wn) : 0;
  const disc = tr * tr - 4 * det;
  const root = disc < 0 ? { re: tr / 2, im: Math.sqrt(-disc) / 2 } : { re: (tr + Math.sqrt(disc)) / 2, im: 0 };
  return { wn, zeta, root };
}

function longApprox(A: readonly (readonly number[])[]): Approximation[] {
  const sp = pairOf(A[1]![1]!, A[1]![2]!, A[2]![1]!, A[2]![2]!);
  const g = -A[0]![3]!;
  const U0 = A[1]![2]!;
  const Zu = A[1]![0]!;
  const Xu = A[0]![0]!;
  const out: Approximation[] = [{ id: 'shortPeriod', ...sp }];
  if (U0 > 0 && g > 0 && Zu < 0) {
    const wn = Math.sqrt((-Zu * g) / U0);
    out.push({ id: 'phugoid', wn, zeta: -Xu / (2 * wn) });
  }
  return out;
}

function latApprox(A: readonly (readonly number[])[]): Approximation[] {
  const dr = pairOf(A[0]![0]!, A[0]![2]!, A[2]![0]!, A[2]![2]!);
  const Lp = A[1]![1]!;
  const out: Approximation[] = [
    { id: 'dutchRoll', ...dr },
    { id: 'roll', wn: Math.abs(Lp), zeta: Lp < 0 ? 1 : -1, root: { re: Lp, im: 0 } },
  ];
  const Lv = A[1]![0]!;
  if (Math.abs(Lv) > 1e-12) {
    const s = (Lv * A[2]![2]! - A[1]![2]! * A[2]![0]!) / Lv;
    out.push({ id: 'spiral', wn: Math.abs(s), zeta: s < 0 ? 1 : -1, root: { re: s, im: 0 } });
  }
  return out;
}
