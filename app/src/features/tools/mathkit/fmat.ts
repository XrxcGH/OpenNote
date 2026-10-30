// Floating-point matrix routines on plain row arrays, shared by the matrix console and the linear algebra workbench:
// LU with partial pivoting, determinant, inverse, solving, least squares, rank, pseudoinverse, and norms.
import { identity, matMul, type Mat } from './dense';
import { svd } from './eigen';

export interface Lu {
  /** L (unit lower) and U (upper) packed together, as rows of the permuted matrix. */
  lu: Mat;
  /** perm[i] is the row of the original matrix now in row i. */
  perm: number[];
  sign: 1 | -1;
  singular: boolean;
}

export const transposeF = (A: Mat): Mat => A[0].map((_, j) => A.map((row) => row[j]));

/** LU factorization of a square matrix with partial pivoting. */
export function luFactor(A: Mat): Lu {
  const n = A.length;
  const lu = A.map((row) => row.slice());
  const perm = Array.from({ length: n }, (_, i) => i);
  let sign: 1 | -1 = 1;
  let singular = false;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(lu[r][col]) > Math.abs(lu[pivot][col])) pivot = r;
    if (lu[pivot][col] === 0) {
      singular = true;
      continue;
    }
    if (pivot !== col) {
      [lu[col], lu[pivot]] = [lu[pivot], lu[col]];
      [perm[col], perm[pivot]] = [perm[pivot], perm[col]];
      sign = -sign as 1 | -1;
    }
    for (let r = col + 1; r < n; r++) {
      lu[r][col] /= lu[col][col];
      for (let k = col + 1; k < n; k++) lu[r][k] -= lu[r][col] * lu[col][k];
    }
  }
  return { lu, perm, sign, singular };
}

export function determinant(A: Mat): number {
  const { lu, sign } = luFactor(A);
  return lu.reduce<number>((p, row, i) => p * row[i], sign);
}

/** A reciprocal condition estimate from the pivots: small means the matrix is nearly singular. */
export function pivotRatio(A: Mat): number {
  const { lu, singular } = luFactor(A);
  if (singular) return 0;
  const d = lu.map((row, i) => Math.abs(row[i]));
  return Math.min(...d) / Math.max(...d);
}

/** Solves A X = B for square A. Null when A is singular. */
export function solveSquare(A: Mat, B: Mat): Mat | null {
  const n = A.length;
  const f = luFactor(A);
  if (f.singular) return null;
  const m = B[0].length;
  const X: Mat = Array.from({ length: n }, () => new Array<number>(m).fill(0));
  for (let c = 0; c < m; c++) {
    const y = f.perm.map((p) => B[p][c]);
    for (let i = 0; i < n; i++) for (let k = 0; k < i; k++) y[i] -= f.lu[i][k] * y[k];
    for (let i = n - 1; i >= 0; i--) {
      for (let k = i + 1; k < n; k++) y[i] -= f.lu[i][k] * y[k];
      y[i] /= f.lu[i][i];
    }
    for (let i = 0; i < n; i++) X[i][c] = y[i];
  }
  return X;
}

export const inverseF = (A: Mat): Mat | null => solveSquare(A, identity(A.length));

/** The pseudoinverse by the singular value decomposition. */
export function pinv(A: Mat): Mat {
  const { U, S, V } = svd(A);
  const tol = Math.max(A.length, A[0].length) * (S[0] ?? 0) * 2.2e-16;
  const m = A.length;
  const n = A[0].length;
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: m }, (_, j) => S.reduce((s, sv, k) => (sv > tol ? s + (V[i][k] * U[j][k]) / sv : s), 0)),
  );
}

/** Least squares and minimum-norm solutions of A X = B for any shape. */
export function lstsq(A: Mat, B: Mat): Mat {
  return matMul(pinv(A), B);
}

export function rankF(A: Mat): number {
  const { S } = svd(A);
  const tol = Math.max(A.length, A[0].length) * (S[0] ?? 0) * 2.2e-16;
  return S.filter((s) => s > tol).length;
}

export function matPower(A: Mat, k: number): Mat | null {
  let base = k < 0 ? inverseF(A) : A;
  if (!base) return null;
  let e = Math.abs(k);
  let result = identity(A.length);
  while (e > 0) {
    if (e & 1) result = matMul(result, base);
    base = matMul(base, base);
    e = Math.floor(e / 2);
  }
  return result;
}

/** The p-norm of a vector, or the induced 1, 2, infinity, or Frobenius norm of a matrix. */
export function normOf(A: Mat, p: number | 'fro'): number {
  const flat = A.flat();
  const vector = A.length === 1 || A[0].length === 1;
  if (vector) {
    const q = p === 'fro' ? 2 : p;
    if (q === Infinity) return Math.max(...flat.map(Math.abs));
    if (q === -Infinity) return Math.min(...flat.map(Math.abs));
    if (q === 1) return flat.reduce((s, v) => s + Math.abs(v), 0);
    return flat.reduce((s, v) => s + Math.abs(v) ** q, 0) ** (1 / q);
  }
  if (p === 'fro') return Math.sqrt(flat.reduce((s, v) => s + v * v, 0));
  if (p === 1) return Math.max(...A[0].map((_, j) => A.reduce((s, row) => s + Math.abs(row[j]), 0)));
  if (p === Infinity) return Math.max(...A.map((row) => row.reduce((s, v) => s + Math.abs(v), 0)));
  return svd(A).S[0] ?? 0;
}
