// LU decomposition with partial pivoting, after JAMA (public domain, NIST, and The MathWorks): PA = LU with L unit
// lower triangular. It gives the determinant and solves square systems. A pivot that is tiny next to the matrix's
// size counts as zero, so a nearly singular system says so instead of returning huge numbers.
import { NumError } from '../errors';
import { clone, cols, normInf, rows, zeros } from './basic';
import type { Matrix, MatrixLike } from './basic';

const EPS = 2 ** -52;

export interface Lu {
  /** L and U packed together: U on and above the diagonal, L's multipliers below it. */
  lu: Matrix;
  /** Row i of PA is row piv[i] of A. */
  piv: number[];
  /** +1 or -1: the sign of the permutation. */
  sign: number;
  /** Whether a pivot came out zero (to rounding). */
  singular: boolean;
}

export function luDecompose(a: MatrixLike): Lu {
  const lu = clone(a);
  const m = rows(a);
  const n = cols(a);
  const piv = Array.from({ length: m }, (_, i) => i);
  let sign = 1;
  const colj = new Array<number>(m);
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < m; i += 1) colj[i] = lu[i][j];
    for (let i = 0; i < m; i += 1) {
      const rowi = lu[i];
      const kmax = Math.min(i, j);
      let s = 0;
      for (let k = 0; k < kmax; k += 1) s += rowi[k] * colj[k];
      colj[i] -= s;
      rowi[j] = colj[i];
    }
    let p = j;
    for (let i = j + 1; i < m; i += 1) if (Math.abs(colj[i]) > Math.abs(colj[p])) p = i;
    if (p !== j) {
      [lu[p], lu[j]] = [lu[j], lu[p]];
      [piv[p], piv[j]] = [piv[j], piv[p]];
      sign = -sign;
    }
    if (j < m && lu[j][j] !== 0) for (let i = j + 1; i < m; i += 1) lu[i][j] /= lu[j][j];
  }
  const tol = Math.max(m, n) * EPS * normInf(a);
  const order = Math.min(m, n);
  let singular = false;
  for (let j = 0; j < order; j += 1) if (Math.abs(lu[j][j]) <= tol) singular = true;
  return { lu, piv, sign, singular };
}

export function luDeterminant(f: Lu): number {
  const n = f.lu.length;
  if (n !== f.lu[0].length) throw new NumError('notSquare');
  let d = f.sign;
  for (let j = 0; j < n; j += 1) d *= f.lu[j][j];
  return d;
}

/** Solves AX = B for X, given A's factors. Throws 'singular' when A is singular to rounding. */
export function luSolve(f: Lu, b: MatrixLike): Matrix {
  const n = f.lu.length;
  if (rows(b) !== n) throw new NumError('shape');
  if (n !== f.lu[0].length) throw new NumError('notSquare');
  if (f.singular) throw new NumError('singular');
  const nx = cols(b);
  const x = zeros(n, nx);
  for (let i = 0; i < n; i += 1) for (let j = 0; j < nx; j += 1) x[i][j] = b[f.piv[i]][j];
  for (let k = 0; k < n; k += 1)
    for (let i = k + 1; i < n; i += 1) for (let j = 0; j < nx; j += 1) x[i][j] -= x[k][j] * f.lu[i][k];
  for (let k = n - 1; k >= 0; k -= 1) {
    for (let j = 0; j < nx; j += 1) x[k][j] /= f.lu[k][k];
    for (let i = 0; i < k; i += 1) for (let j = 0; j < nx; j += 1) x[i][j] -= x[k][j] * f.lu[i][k];
  }
  return x;
}

/** The unit lower triangular factor L. */
export const luL = (f: Lu): Matrix =>
  f.lu.map((row, i) => row.slice(0, Math.min(f.lu.length, row.length)).map((x, j) => (i > j ? x : i === j ? 1 : 0)));

/** The upper triangular factor U. */
export const luU = (f: Lu): Matrix =>
  f.lu.slice(0, Math.min(f.lu.length, f.lu[0].length)).map((row, i) => row.map((x, j) => (i <= j ? x : 0)));
