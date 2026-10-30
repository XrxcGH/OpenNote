// Classical lamination theory. Each ply is an orthotropic lamina in plane stress, with reduced stiffness Q in its
// own axes (1 along the fibers) and Q̄ in the laminate's axes after turning by its angle θ, counterclockwise from x.
// A, B, and D sum Q̄ over the plies, through z from −h/2 at the face of ply 1 to +h/2 at the face of the last. The
// mid-plane strains and curvatures come from inverting [A B; B D] against the loads per unit width, and each ply's
// stresses from Q̄ at its faces. Failure is checked in the material axes by maximum stress, Tsai–Hill, and Tsai–Wu
// with F12 = −½√(F11 F22). Everything is in base SI: Pa, m, N/m, and N.
import { solveLinear } from '../../linalg';
import { fail, positive, q, step, type KitStep } from '../kit/types';

export interface Lamina {
  readonly E1: number;
  readonly E2: number;
  readonly nu12: number;
  readonly G12: number;
}

export interface Strengths {
  readonly Xt: number;
  readonly Xc: number;
  readonly Yt: number;
  readonly Yc: number;
  readonly S: number;
}

/** Q11, Q12, Q22, Q66. */
export function reducedStiffness(m: Lamina) {
  const E1 = positive(m.E1, 'E1');
  const E2 = positive(m.E2, 'E2');
  const G12 = positive(m.G12, 'G12');
  const nu21 = (m.nu12 * E2) / E1;
  if (!Number.isFinite(m.nu12) || m.nu12 * nu21 >= 1) fail('laminaPoisson');
  const d = 1 - m.nu12 * nu21;
  return { Q11: E1 / d, Q12: (m.nu12 * E2) / d, Q22: E2 / d, Q66: G12 };
}

export type Q3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

/** Q̄ in the laminate axes for a ply turned by θ, as a 3 × 3 matrix on (x, y, xy). */
export function transformedStiffness(Q: ReturnType<typeof reducedStiffness>, theta: number): Q3 {
  const [m, n] = [Math.cos(theta), Math.sin(theta)];
  const [m2, n2] = [m * m, n * n];
  const { Q11, Q12, Q22, Q66 } = Q;
  const a = Q11 * m2 * m2 + 2 * (Q12 + 2 * Q66) * m2 * n2 + Q22 * n2 * n2;
  const b = (Q11 + Q22 - 4 * Q66) * m2 * n2 + Q12 * (m2 * m2 + n2 * n2);
  const c = Q11 * n2 * n2 + 2 * (Q12 + 2 * Q66) * m2 * n2 + Q22 * m2 * m2;
  const e = (Q11 - Q12 - 2 * Q66) * m2 * m * n + (Q12 - Q22 + 2 * Q66) * m * n2 * n;
  const f = (Q11 - Q12 - 2 * Q66) * m * n2 * n + (Q12 - Q22 + 2 * Q66) * m2 * m * n;
  const g = (Q11 + Q22 - 2 * Q12 - 2 * Q66) * m2 * n2 + Q66 * (m2 * m2 + n2 * n2);
  return [
    [a, b, e],
    [b, c, f],
    [e, f, g],
  ];
}

/** Reads a layup such as "0 90 90 0", "[0/90]s", "[±45/0]2s", or "[0/45/-45/90]s" into angles in degrees. */
export function readLayup(text: string): number[] {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  const bracket = /^\[(.*)\]\s*(\d*)\s*(s?)$/i.exec(trimmed);
  const inner = bracket ? bracket[1] : trimmed;
  const angles: number[] = [];
  for (const word of inner.split(/[\s,/]+/).filter(Boolean)) {
    const pm = /^(±|\+-|\+\/-)(.+)$/.exec(word);
    const value = Number(pm ? pm[2] : word);
    if (!Number.isFinite(value)) fail('layup', word);
    if (pm) angles.push(value, -value);
    else angles.push(value);
  }
  if (angles.length === 0) fail('layup', text);
  const repeat = bracket && bracket[2] ? Number(bracket[2]) : 1;
  if (!(repeat >= 1 && repeat <= 50)) fail('layup', text);
  const repeated = [...Array(repeat).keys()].flatMap(() => angles);
  return bracket && bracket[3] ? [...repeated, ...[...repeated].reverse()] : repeated;
}

export interface LaminateInput {
  readonly lamina: Lamina;
  readonly t: number;
  /** Ply angles in radians, from ply 1. */
  readonly angles: readonly number[];
  /** Nx, Ny, Nxy (N/m) and Mx, My, Mxy (N·m/m). */
  readonly N: readonly [number, number, number];
  readonly M: readonly [number, number, number];
  readonly strengths?: Strengths;
}

export interface PlyFace {
  readonly ply: number;
  readonly z: number;
  readonly global: readonly [number, number, number];
  readonly local: readonly [number, number, number];
  readonly maxStress?: number;
  readonly tsaiHill?: number;
  readonly tsaiWu?: number;
  /** The load factor at failure by Tsai–Wu, maximum stress, and Tsai–Hill. */
  readonly ratioWu?: number;
  readonly ratioMax?: number;
  readonly ratioHill?: number;
}

const zero3 = () => [0, 0, 0].map(() => [0, 0, 0]);

function invert6(K: readonly (readonly number[])[]): number[][] | null {
  const columns: number[][] = [];
  for (let c = 0; c < 6; c++) {
    const e = [0, 0, 0, 0, 0, 0];
    e[c] = 1;
    const x = solveLinear(K, e);
    if (!x) return null;
    columns.push(x);
  }
  return K.map((_, r) => columns.map((col) => col[r]));
}

/** σ1, σ2, τ12 from σx, σy, τxy for a ply at θ. */
export function toMaterial([sx, sy, txy]: readonly number[], theta: number): [number, number, number] {
  const [m, n] = [Math.cos(theta), Math.sin(theta)];
  return [
    m * m * sx + n * n * sy + 2 * m * n * txy,
    n * n * sx + m * m * sy - 2 * m * n * txy,
    -m * n * sx + m * n * sy + (m * m - n * n) * txy,
  ];
}

/** The failure indices and strength ratios of a ply's stresses in its material axes. */
export function failure([s1, s2, t12]: readonly number[], st: Strengths) {
  const [Xt, Xc, Yt, Yc, S] = [st.Xt, st.Xc, st.Yt, st.Yc, st.S].map((v, i) =>
    positive(v, ['Xt', 'Xc', 'Yt', 'Yc', 'S'][i]),
  );
  const X = s1 >= 0 ? Xt : Xc;
  const Y = s2 >= 0 ? Yt : Yc;
  const maxStress = Math.max(Math.abs(s1) / X, Math.abs(s2) / Y, Math.abs(t12) / S);
  const tsaiHill = (s1 / X) ** 2 - (s1 * s2) / X ** 2 + (s2 / Y) ** 2 + (t12 / S) ** 2;
  const [F1, F2, F11, F22, F66] = [1 / Xt - 1 / Xc, 1 / Yt - 1 / Yc, 1 / (Xt * Xc), 1 / (Yt * Yc), 1 / (S * S)];
  const F12 = -0.5 * Math.sqrt(F11 * F22);
  const quadratic = F11 * s1 * s1 + F22 * s2 * s2 + F66 * t12 * t12 + 2 * F12 * s1 * s2;
  const linear = F1 * s1 + F2 * s2;
  const tsaiWu = quadratic + linear;
  // Scaling every stress by R makes the Tsai–Wu index 1: quadratic R² + linear R − 1 = 0.
  const ratioWu =
    quadratic > 0
      ? (-linear + Math.sqrt(linear * linear + 4 * quadratic)) / (2 * quadratic)
      : linear > 0
        ? 1 / linear
        : Infinity;
  return {
    maxStress,
    tsaiHill,
    tsaiWu,
    ratioWu,
    ratioMax: maxStress > 0 ? 1 / maxStress : Infinity,
    ratioHill: tsaiHill > 0 ? 1 / Math.sqrt(tsaiHill) : Infinity,
  };
}

export function laminate(input: LaminateInput) {
  const Q = reducedStiffness(input.lamina);
  const t = positive(input.t, 't');
  if (input.angles.length === 0) fail('layup', '');
  if (input.angles.length > 200) fail('layup', String(input.angles.length));
  const h = t * input.angles.length;
  const Qbar = input.angles.map((theta) => transformedStiffness(Q, theta));
  const [A, B, D] = [zero3(), zero3(), zero3()];
  const z = (k: number) => -h / 2 + k * t;
  Qbar.forEach((Qk, k) => {
    const [z0, z1] = [z(k), z(k + 1)];
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        A[i][j] += Qk[i][j] * (z1 - z0);
        B[i][j] += (Qk[i][j] * (z1 * z1 - z0 * z0)) / 2;
        D[i][j] += (Qk[i][j] * (z1 ** 3 - z0 ** 3)) / 3;
      }
  });
  const ABD = [0, 1, 2, 3, 4, 5].map((r) =>
    [0, 1, 2, 3, 4, 5].map((c) => (r < 3 ? (c < 3 ? A[r][c] : B[r][c - 3]) : c < 3 ? B[r - 3][c] : D[r - 3][c - 3])),
  );
  const compliance = invert6(ABD);
  if (!compliance) fail('singularLaminate');
  const loads = [...input.N, ...input.M];
  const strains = compliance.map((row) => row.reduce((sum, value, c) => sum + value * loads[c], 0));
  const [e0, kappa] = [strains.slice(0, 3), strains.slice(3)];
  const faces: PlyFace[] = [];
  Qbar.forEach((Qk, k) => {
    for (const zf of [z(k), z(k + 1)]) {
      const e = [0, 1, 2].map((i) => e0[i] + zf * kappa[i]);
      const global = [0, 1, 2].map((i) => Qk[i].reduce((sum, value, j) => sum + value * e[j], 0)) as [
        number,
        number,
        number,
      ];
      const local = toMaterial(global, input.angles[k]);
      faces.push({ ply: k + 1, z: zf, global, local, ...(input.strengths ? failure(local, input.strengths) : {}) });
    }
  });
  const engineering = {
    Ex: 1 / (h * compliance[0][0]),
    Ey: 1 / (h * compliance[1][1]),
    Gxy: 1 / (h * compliance[2][2]),
    nuxy: -compliance[0][1] / compliance[0][0],
  };
  return { Q, Qbar, A, B, D, h, e0, kappa, faces, engineering, steps: laminateSteps(Q, A, B, D, e0, kappa, h) };
}

function laminateSteps(
  Q: ReturnType<typeof reducedStiffness>,
  A: number[][],
  B: number[][],
  D: number[][],
  e0: number[],
  kappa: number[],
  h: number,
): KitStep[] {
  return [
    step(
      'composites.Q',
      'Q_{11} = \\frac{E_1}{1 - \\nu_{12}\\nu_{21}} = [[Q11]], \\quad Q_{12} = [[Q12]], \\quad Q_{22} = [[Q22]],' +
        ' \\quad Q_{66} = G_{12} = [[Q66]]',
      { Q11: q(Q.Q11, 'stress'), Q12: q(Q.Q12, 'stress'), Q22: q(Q.Q22, 'stress'), Q66: q(Q.Q66, 'stress') },
    ),
    step(
      'composites.Qbar',
      '\\bar Q_{11} = Q_{11} m^4 + 2(Q_{12} + 2Q_{66}) m^2 n^2 + Q_{22} n^4, \\quad m = \\cos\\theta,\\ n =' +
        ' \\sin\\theta',
    ),
    step(
      'composites.ABD',
      '(A, B, D)_{ij} = \\sum_k \\bar Q_{ij}^{(k)} \\left(z_k - z_{k-1},\\ \\tfrac12(z_k^2 -' +
        ' z_{k-1}^2),\\ \\tfrac13(z_k^3 - z_{k-1}^3)\\right)',
    ),
    step('composites.sums', 'A_{11} = [[A11]], \\quad B_{11} = [[B11]], \\quad D_{11} = [[D11]], \\quad h = [[h]]', {
      A11: q(A[0][0], 'lineLoad'),
      B11: q(B[0][0], 'smallForce'),
      D11: q(D[0][0], 'moment'),
      h: q(h, 'length'),
    }),
    step(
      'composites.invert',
      '\\begin{bmatrix}\\varepsilon^0 \\\\ \\kappa\\end{bmatrix} = \\begin{bmatrix}A & B \\\\ B &' +
        ' D\\end{bmatrix}^{-1}\\begin{bmatrix}N \\\\ M\\end{bmatrix}: ' +
        '\\varepsilon_x^0 = [[ex]],\\ \\varepsilon_y^0 = [[ey]],\\ \\gamma_{xy}^0 = [[gxy]]',
      { ex: q(e0[0], 'strain'), ey: q(e0[1], 'strain'), gxy: q(e0[2], 'strain') },
    ),
    step('composites.curvature', '\\kappa_x = [[kx]],\\ \\kappa_y = [[ky]],\\ \\kappa_{xy} = [[kxy]]', {
      kx: q(kappa[0], 'curvature'),
      ky: q(kappa[1], 'curvature'),
      kxy: q(kappa[2], 'curvature'),
    }),
    step(
      'composites.plyStress',
      '\\{\\sigma\\}_x = [\\bar Q]\\left(\\{\\varepsilon^0\\} + z\\{\\kappa\\}\\right), \\quad \\{\\sigma\\}_1 =' +
        ' [T]\\{\\sigma\\}_x',
    ),
  ];
}
