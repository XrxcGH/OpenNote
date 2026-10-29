// Orientation statistics: the orientation tensor with its eigenvectors and Woodcock's shape and strength, the
// pi-diagram fold axis, Fisher statistics for lines and directions, rose-diagram bins, and counting-circle densities.
import { check } from '../core/problem';
import { lineOf, unit, vector } from './geometry';
import type { Line, Vec } from './geometry';

/** Eigenvalues (largest first) and unit eigenvectors of a symmetric 3 × 3 matrix by Jacobi rotations. */
export function eigenSymmetric(m: readonly (readonly number[])[]): { values: number[]; vectors: Vec[] } {
  const a = m.map((row) => [...row]);
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = a[0][1] ** 2 + a[0][2] ** 2 + a[1][2] ** 2;
    if (off < 1e-30) break;
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p];
        const akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k];
        const aqk = a[q][k];
        a[p][k] = c * apk - s * aqk;
        a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p];
        const vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq;
        v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[j][j] - a[i][i]);
  return {
    values: order.map((i) => a[i][i]),
    vectors: order.map((i) => [v[0][i], v[1][i], v[2][i]] as Vec),
  };
}

export interface Tensor {
  values: number[];
  axes: Line[];
  /** Woodcock (1977) shape K = ln(e1/e2)/ln(e2/e3): above 1 a cluster, below 1 a girdle. */
  shape: number;
  /** Woodcock strength C = ln(e1/e3). */
  strength: number;
}

/** The orientation tensor T = (1/N) Σ v·vᵀ of lines (axial data). */
export function orientationTensor(lines: readonly Line[]): Tensor {
  check(lines.length >= 2, 'lines');
  const t = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const line of lines) {
    const v = vector(line);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) t[i][j] += (v[i] * v[j]) / lines.length;
  }
  const { values, vectors } = eigenSymmetric(t);
  const [e1, e2, e3] = values.map((x) => Math.max(x, 1e-300));
  return {
    values,
    axes: vectors.map((v) => lineOf(v)),
    shape: Math.log(e2 / e3) === 0 ? Number.POSITIVE_INFINITY : Math.log(e1 / e2) / Math.log(e2 / e3),
    strength: Math.log(e1 / e3),
  };
}

export interface Fisher {
  mean: Line;
  r: number;
  n: number;
  kappa: number;
  alpha95: number;
}

/**
 * Fisher (1953) statistics: the mean of unit vectors, the resultant length R, the precision k = (N − 1)/(N − R),
 * and the 95% cone α95 = arccos(1 − (N − R)/R × (20^(1/(N − 1)) − 1)).
 */
export function fisher(lines: readonly Line[], directions = false): Fisher {
  const n = lines.length;
  check(n >= 2, 'lines');
  const sum = lines.reduce<[number, number, number]>(
    (s, line) => {
      const v = vector(line);
      return [s[0] + v[0], s[1] + v[1], s[2] + v[2]];
    },
    [0, 0, 0],
  );
  const r = Math.hypot(...sum);
  check(r > 1e-9, 'spread');
  const kappa = n - r < 1e-12 ? Number.POSITIVE_INFINITY : (n - 1) / (n - r);
  const cos = 1 - ((n - r) / r) * (20 ** (1 / (n - 1)) - 1);
  return {
    mean: lineOf(unit(sum), directions),
    r,
    n,
    kappa,
    alpha95: cos <= -1 ? 180 : (Math.acos(Math.min(1, cos)) * 180) / Math.PI,
  };
}

/** Counts in bins of `width` degrees; axial data (strikes, trends of lines) also count at the opposite azimuth. */
export function roseBins(azimuths: readonly number[], width: number, axial: boolean): number[] {
  check(width > 0 && 360 % width === 0, 'bin');
  const bins = new Array<number>(360 / width).fill(0);
  for (const a of azimuths) {
    const at = ((a % 360) + 360) % 360;
    bins[Math.floor(at / width) % bins.length]++;
    if (axial) bins[Math.floor(((at + 180) % 360) / width) % bins.length]++;
  }
  return bins;
}

/**
 * The percent of lines within a counting circle of 1% of the hemisphere's area around `center`: the cone of
 * half-angle θ with 1 − cos θ = 0.01. Lines are axial, so the cone also counts their opposites.
 */
export function density(lines: readonly Vec[], center: Vec, area = 0.01): number {
  const cos = 1 - area;
  const inside = lines.filter((v) => Math.abs(v[0] * center[0] + v[1] * center[1] + v[2] * center[2]) >= cos).length;
  return (100 * inside) / lines.length;
}
