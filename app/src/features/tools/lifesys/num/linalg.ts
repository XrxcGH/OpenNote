// Small dense linear algebra for the fits and matrix models: solving, inverting, and the dominant eigenpair of a
// non-negative matrix (Leslie and Lefkovitch matrices). Pivots are judged relative to the matrix's size, so
// concentrations in nM fit as well as counts in thousands.
import { LsError } from './errors';

export type Mat = number[][];

/** Solves A x = b by Gaussian elimination with partial pivoting. Throws errors.singular. */
export function solveLinear(a: readonly (readonly number[])[], b: readonly number[]): number[] {
  const n = a.length;
  const m = a.map((row, i) => [...row, b[i]]);
  const scale = Math.max(...a.flat().map(Math.abs), 1e-300);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) <= scale * 1e-13) throw new LsError('errors.singular');
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const factor = m[r][col] / m[col][col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c += 1) m[r][c] -= factor * m[col][c];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

/** The inverse of a square matrix. Throws errors.singular. */
export function invert(a: readonly (readonly number[])[]): Mat {
  const n = a.length;
  const columns = Array.from({ length: n }, (_, j) =>
    solveLinear(
      a,
      a.map((_, i) => (i === j ? 1 : 0)),
    ),
  );
  return Array.from({ length: n }, (_, i) => columns.map((column) => column[i]));
}

export const transpose = (a: readonly (readonly number[])[]): Mat => a[0].map((_, j) => a.map((row) => row[j]));

export const matVec = (a: readonly (readonly number[])[], v: readonly number[]): number[] =>
  a.map((row) => row.reduce((sum, value, j) => sum + value * v[j], 0));

export interface Dominant {
  value: number;
  /** The right eigenvector, scaled to sum to 1. */
  right: number[];
  /** The left eigenvector, scaled so that left · right = 1. */
  left: number[];
  iterations: number;
}

function power(
  a: readonly (readonly number[])[],
  maxIter: number,
): { value: number; vector: number[]; iterations: number } {
  const n = a.length;
  let v = Array.from({ length: n }, () => 1 / n);
  for (let i = 1; i <= maxIter; i += 1) {
    const w = matVec(a, v);
    const sum = w.reduce((s, x) => s + x, 0);
    if (!(sum > 0)) throw new LsError('errors.eigen');
    const next = w.map((x) => x / sum);
    const change = next.reduce((s, x, j) => Math.max(s, Math.abs(x - v[j])), 0);
    v = next;
    if (change < 1e-14) return { value: sum, vector: v, iterations: i };
  }
  throw new LsError('errors.eigen');
}

/**
 * The dominant eigenvalue of a non-negative matrix with its right and left eigenvectors, by power iteration on
 * (A + I), which converges for irreducible matrices even when A itself is periodic.
 */
export function dominantEigen(a: readonly (readonly number[])[], maxIter = 100_000): Dominant {
  if (a.some((row) => row.some((x) => !Number.isFinite(x) || x < 0))) throw new LsError('errors.nonNegativeMatrix');
  const shifted = a.map((row, i) => row.map((x, j) => x + (i === j ? 1 : 0)));
  const right = power(shifted, maxIter);
  const left = power(transpose(shifted), maxIter);
  const dot = left.vector.reduce((s, x, i) => s + x * right.vector[i], 0);
  return {
    value: right.value - 1,
    right: right.vector,
    left: left.vector.map((x) => x / dot),
    iterations: right.iterations,
  };
}

/** The eigenvalues of a 2 x 2 matrix [[a, b], [c, d]], as real and imaginary parts. */
export function eigen2(a: number, b: number, c: number, d: number): { re: number; im: number }[] {
  const tr = a + d;
  const det = a * d - b * c;
  const disc = (tr * tr) / 4 - det;
  if (disc >= 0) {
    const root = Math.sqrt(disc);
    return [
      { re: tr / 2 + root, im: 0 },
      { re: tr / 2 - root, im: 0 },
    ];
  }
  const root = Math.sqrt(-disc);
  return [
    { re: tr / 2, im: root },
    { re: tr / 2, im: -root },
  ];
}
