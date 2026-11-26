// Cholesky decomposition, after JAMA (public domain, NIST, and The MathWorks): A = L·Lᵀ for a symmetric positive
// definite A, with L lower triangular. It solves such systems in half the work of LU and tells whether A is SPD.
import { NumError } from '../errors';
import { cols, isSymmetric, rows, zeros } from './basic';
import type { Matrix, MatrixLike } from './basic';

export interface Cholesky {
  l: Matrix;
  /** Whether A is symmetric and positive definite. */
  spd: boolean;
}

export function cholesky(a: MatrixLike): Cholesky {
  const n = rows(a);
  const l = zeros(n);
  let spd = cols(a) === n && isSymmetric(a);
  for (let j = 0; j < n && spd; j += 1) {
    let d = 0;
    for (let k = 0; k < j; k += 1) {
      let s = 0;
      for (let i = 0; i < k; i += 1) s += l[k][i] * l[j][i];
      s = (a[j][k] - s) / l[k][k];
      l[j][k] = s;
      d += s * s;
    }
    d = a[j][j] - d;
    spd = d > 0;
    l[j][j] = Math.sqrt(Math.max(d, 0));
  }
  return { l, spd };
}

/** Solves AX = B with A = L·Lᵀ. Throws 'notPositiveDefinite' when A is not SPD. */
export function choleskySolve(f: Cholesky, b: MatrixLike): Matrix {
  const n = f.l.length;
  if (rows(b) !== n) throw new NumError('shape');
  if (!f.spd) throw new NumError('notPositiveDefinite');
  const nx = cols(b);
  const x = b.map((row) => [...row]);
  for (let k = 0; k < n; k += 1)
    for (let j = 0; j < nx; j += 1) {
      for (let i = 0; i < k; i += 1) x[k][j] -= x[i][j] * f.l[k][i];
      x[k][j] /= f.l[k][k];
    }
  for (let k = n - 1; k >= 0; k -= 1)
    for (let j = 0; j < nx; j += 1) {
      for (let i = k + 1; i < n; i += 1) x[k][j] -= x[i][j] * f.l[i][k];
      x[k][j] /= f.l[k][k];
    }
  return x;
}
