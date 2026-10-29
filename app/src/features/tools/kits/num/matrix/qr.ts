// QR decomposition by Householder reflections, after JAMA (public domain, NIST, and The MathWorks): A = QR for an m by n
// A with m >= n, Q with orthonormal columns, and R upper triangular. It solves least-squares problems.
import { NumError } from '../errors';
import { clone, cols, hypot, normF, rows, zeros } from './basic';
import type { Matrix, MatrixLike } from './basic';

const EPS = 2 ** -52;

export interface Qr {
  /** The Householder vectors below the diagonal, R above it. */
  qr: Matrix;
  rdiag: number[];
  fullRank: boolean;
}

export function qrDecompose(a: MatrixLike): Qr {
  const qr = clone(a);
  const m = rows(a);
  const n = cols(a);
  if (m < n) throw new NumError('shape', 'QR needs at least as many rows as columns');
  const rdiag = new Array<number>(n).fill(0);
  for (let k = 0; k < n; k += 1) {
    let nrm = 0;
    for (let i = k; i < m; i += 1) nrm = hypot(nrm, qr[i][k]);
    if (nrm !== 0) {
      if (qr[k][k] < 0) nrm = -nrm;
      for (let i = k; i < m; i += 1) qr[i][k] /= nrm;
      qr[k][k] += 1;
      for (let j = k + 1; j < n; j += 1) {
        let s = 0;
        for (let i = k; i < m; i += 1) s += qr[i][k] * qr[i][j];
        s = -s / qr[k][k];
        for (let i = k; i < m; i += 1) qr[i][j] += s * qr[i][k];
      }
    }
    rdiag[k] = -nrm;
  }
  const tol = Math.max(m, n) * EPS * normF(a);
  return { qr, rdiag, fullRank: rdiag.every((d) => Math.abs(d) > tol) };
}

export function qrR(f: Qr): Matrix {
  const n = f.rdiag.length;
  const r = zeros(n, n);
  for (let i = 0; i < n; i += 1) for (let j = i; j < n; j += 1) r[i][j] = i === j ? f.rdiag[i] : f.qr[i][j];
  return r;
}

export function qrQ(f: Qr): Matrix {
  const m = f.qr.length;
  const n = f.rdiag.length;
  const q = zeros(m, n);
  for (let k = n - 1; k >= 0; k -= 1) {
    q[k][k] = 1;
    for (let j = k; j < n; j += 1) {
      if (f.qr[k][k] === 0) continue;
      let s = 0;
      for (let i = k; i < m; i += 1) s += f.qr[i][k] * q[i][j];
      s = -s / f.qr[k][k];
      for (let i = k; i < m; i += 1) q[i][j] += s * f.qr[i][k];
    }
  }
  return q;
}

/** The least-squares solution X of AX = B. Throws 'singular' when A's columns are dependent. */
export function qrSolve(f: Qr, b: MatrixLike): Matrix {
  const m = f.qr.length;
  const n = f.rdiag.length;
  if (rows(b) !== m) throw new NumError('shape');
  if (!f.fullRank) throw new NumError('singular', 'the columns are dependent');
  const nx = cols(b);
  const x = clone(b);
  for (let k = 0; k < n; k += 1) {
    for (let j = 0; j < nx; j += 1) {
      let s = 0;
      for (let i = k; i < m; i += 1) s += f.qr[i][k] * x[i][j];
      s = -s / f.qr[k][k];
      for (let i = k; i < m; i += 1) x[i][j] += s * f.qr[i][k];
    }
  }
  for (let k = n - 1; k >= 0; k -= 1) {
    for (let j = 0; j < nx; j += 1) x[k][j] /= f.rdiag[k];
    for (let i = 0; i < k; i += 1) for (let j = 0; j < nx; j += 1) x[i][j] -= x[k][j] * f.qr[i][k];
  }
  return x.slice(0, n);
}
