// Element matrices of the finite element tool, in base SI: springs and bars along a line, members of plane
// trusses and frames, constant-strain triangles and four-node quadrilaterals in plane stress, and conduction elements for
// steady heat flow. Each is the textbook form (Logan; Cook, Malkus, Plesha, and Witt).
import { fail, positive } from '../kit/types';
import { zeros } from './core';

export const bar = (EA: number, L: number) => {
  const k = EA / L;
  return [
    [k, -k],
    [-k, k],
  ];
};

/** The consistent mass of a two-node bar: ρAL/6 [2 1; 1 2]. */
export const barMass = (rhoA: number, L: number) => {
  const m = (rhoA * L) / 6;
  return [
    [2 * m, m],
    [m, 2 * m],
  ];
};

export interface Line {
  readonly L: number;
  readonly c: number;
  readonly s: number;
}

export function lineOf(x1: number, y1: number, x2: number, y2: number): Line {
  const L = Math.hypot(x2 - x1, y2 - y1);
  if (!(L > 0)) fail('zeroElement');
  return { L, c: (x2 - x1) / L, s: (y2 - y1) / L };
}

/** A plane truss member, on (u1, v1, u2, v2). */
export function truss(EA: number, { L, c, s }: Line): number[][] {
  const k = EA / L;
  const t = [c * c, c * s, s * s];
  return [
    [t[0], t[1], -t[0], -t[1]],
    [t[1], t[2], -t[1], -t[2]],
    [-t[0], -t[1], t[0], t[1]],
    [-t[1], -t[2], t[1], t[2]],
  ].map((row) => row.map((v) => k * v));
}

/** A Euler–Bernoulli frame member's stiffness in its own axes, on (u1, v1, θ1, u2, v2, θ2). */
export function frameLocal(EA: number, EI: number, L: number): number[][] {
  const [a, b, c, d] = [EA / L, (12 * EI) / L ** 3, (6 * EI) / L ** 2, (4 * EI) / L];
  return [
    [a, 0, 0, -a, 0, 0],
    [0, b, c, 0, -b, c],
    [0, c, d, 0, -c, d / 2],
    [-a, 0, 0, a, 0, 0],
    [0, -b, -c, 0, b, -c],
    [0, c, d / 2, 0, -c, d],
  ];
}

/** The rotation from global to member axes for a frame member. */
export function frameRotation({ c, s }: Line): number[][] {
  const T = zeros(6);
  for (const o of [0, 3]) {
    T[o][o] = c;
    T[o][o + 1] = s;
    T[o + 1][o] = -s;
    T[o + 1][o + 1] = c;
    T[o + 2][o + 2] = 1;
  }
  return T;
}

const multiply = (A: readonly (readonly number[])[], B: readonly (readonly number[])[]) =>
  A.map((row) => B[0].map((_, j) => row.reduce((sum, v, k) => sum + v * B[k][j], 0)));
const transpose = (A: readonly (readonly number[])[]) => A[0].map((_, j) => A.map((row) => row[j]));

export function frame(EA: number, EI: number, line: Line): { k: number[][]; T: number[][]; local: number[][] } {
  const local = frameLocal(EA, EI, line.L);
  const T = frameRotation(line);
  return { k: multiply(multiply(transpose(T), local), T), T, local };
}

export const apply = (A: readonly (readonly number[])[], x: readonly number[]) =>
  A.map((row) => row.reduce((sum, v, k) => sum + v * x[k], 0));

/** The plane-stress elasticity matrix. */
export function planeStress(E: number, nu: number): number[][] {
  positive(E, 'E');
  if (!(nu > -1 && nu < 0.5)) fail('poisson');
  const f = E / (1 - nu * nu);
  return [
    [f, f * nu, 0],
    [f * nu, f, 0],
    [0, 0, (f * (1 - nu)) / 2],
  ];
}

/** A constant-strain triangle's B matrix and area, with its nodes counterclockwise. */
export function cstB(x: readonly number[], y: readonly number[]) {
  const A2 = (x[1] - x[0]) * (y[2] - y[0]) - (x[2] - x[0]) * (y[1] - y[0]);
  if (!(A2 > 0)) fail('badElement');
  const b = [y[1] - y[2], y[2] - y[0], y[0] - y[1]];
  const c = [x[2] - x[1], x[0] - x[2], x[1] - x[0]];
  const B = [
    [b[0], 0, b[1], 0, b[2], 0],
    [0, c[0], 0, c[1], 0, c[2]],
    [c[0], b[0], c[1], b[1], c[2], b[2]],
  ].map((row) => row.map((v) => v / A2));
  return { B, A: A2 / 2, b, c };
}

export function cst(x: readonly number[], y: readonly number[], D: number[][], t: number) {
  const { B, A } = cstB(x, y);
  const k = multiply(multiply(transpose(B), D), B).map((row) => row.map((v) => v * t * A));
  return { k, B };
}

const GAUSS2 = [-1 / Math.sqrt(3), 1 / Math.sqrt(3)];

/** A four-node quadrilateral's B matrix and Jacobian determinant at (ξ, η), with its nodes counterclockwise. */
export function q4B(x: readonly number[], y: readonly number[], xi: number, eta: number) {
  const dN = [
    [-(1 - eta), 1 - eta, 1 + eta, -(1 + eta)].map((v) => v / 4),
    [-(1 - xi), -(1 + xi), 1 + xi, 1 - xi].map((v) => v / 4),
  ];
  const J = [
    [dN[0].reduce((s, v, i) => s + v * x[i], 0), dN[0].reduce((s, v, i) => s + v * y[i], 0)],
    [dN[1].reduce((s, v, i) => s + v * x[i], 0), dN[1].reduce((s, v, i) => s + v * y[i], 0)],
  ];
  const det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
  if (!(det > 0)) fail('badElement');
  const dx = dN[0].map((_, i) => (J[1][1] * dN[0][i] - J[0][1] * dN[1][i]) / det);
  const dy = dN[0].map((_, i) => (-J[1][0] * dN[0][i] + J[0][0] * dN[1][i]) / det);
  const B = [dx.flatMap((v) => [v, 0]), dy.flatMap((v) => [0, v]), dx.flatMap((v, i) => [dy[i], v])];
  return { B, det };
}

export function q4(x: readonly number[], y: readonly number[], D: number[][], t: number) {
  const k = zeros(8);
  for (const xi of GAUSS2)
    for (const eta of GAUSS2) {
      const { B, det } = q4B(x, y, xi, eta);
      const part = multiply(multiply(transpose(B), D), B);
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) k[i][j] += part[i][j] * t * det;
    }
  return { k, B: q4B(x, y, 0, 0).B };
}

/** A conduction element along a line: conductance kA/L, and a uniform source q̇ shared half to each node. */
export const heatLine = (kA: number, L: number, source: number, A: number) => ({
  k: bar(kA, L),
  f: [(source * A * L) / 2, (source * A * L) / 2],
});

/** A triangle conducting heat in its plane: conductance k t A (∇N)ᵀ∇N, and a source shared a third to each node. */
export function heatTriangle(x: readonly number[], y: readonly number[], kc: number, t: number, source: number) {
  const { A, b, c } = cstB(x, y);
  const k = [0, 1, 2].map((i) => [0, 1, 2].map((j) => (kc * t * (b[i] * b[j] + c[i] * c[j])) / (4 * A)));
  return { k, f: [0, 1, 2].map(() => (source * A * t) / 3), b, c, A };
}
