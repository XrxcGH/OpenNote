// The symmetric eigenvalue problem, after JAMA (public domain, NIST, and The MathWorks), which follows the Algol
// procedures tred2 and tql2 of Bowdler, Martin, Reinsch, and Wilkinson (Handbook for Automatic Computation, vol. II):
// Householder reduction to tridiagonal form, then the QL method with implicit shifts. A = V D Vᵀ with V orthogonal and
// the eigenvalues in ascending order.
import { NumError } from '../errors';
import { clone, hypot } from './basic';
import type { Matrix, MatrixLike } from './basic';

const EPS = 2 ** -52;

export interface SymmetricEigen {
  /** The eigenvalues, smallest first. */
  values: number[];
  /** The eigenvectors as columns, unit length, in the same order. */
  vectors: Matrix;
}

/** Reduces the symmetric V to tridiagonal form: d the diagonal, e the subdiagonal, V the accumulated transform. */
function tred2(v: Matrix, d: number[], e: number[]): void {
  const n = v.length;
  for (let j = 0; j < n; j += 1) d[j] = v[n - 1][j];
  for (let i = n - 1; i > 0; i -= 1) {
    let scale = 0;
    let h = 0;
    for (let k = 0; k < i; k += 1) scale += Math.abs(d[k]);
    if (scale === 0) {
      e[i] = d[i - 1];
      for (let j = 0; j < i; j += 1) {
        d[j] = v[i - 1][j];
        v[i][j] = 0;
        v[j][i] = 0;
      }
    } else {
      h = householderStep(v, d, e, i, scale);
    }
    d[i] = h;
  }
  accumulate(v, d);
  e[0] = 0;
}

/** One Householder step of tred2 on row i; returns h. */
function householderStep(v: Matrix, d: number[], e: number[], i: number, scale: number): number {
  let h = 0;
  for (let k = 0; k < i; k += 1) {
    d[k] /= scale;
    h += d[k] * d[k];
  }
  let f = d[i - 1];
  let g = Math.sqrt(h);
  if (f > 0) g = -g;
  e[i] = scale * g;
  h -= f * g;
  d[i - 1] = f - g;
  for (let j = 0; j < i; j += 1) e[j] = 0;
  for (let j = 0; j < i; j += 1) {
    f = d[j];
    v[j][i] = f;
    g = e[j] + v[j][j] * f;
    for (let k = j + 1; k <= i - 1; k += 1) {
      g += v[k][j] * d[k];
      e[k] += v[k][j] * f;
    }
    e[j] = g;
  }
  f = 0;
  for (let j = 0; j < i; j += 1) {
    e[j] /= h;
    f += e[j] * d[j];
  }
  const hh = f / (h + h);
  for (let j = 0; j < i; j += 1) e[j] -= hh * d[j];
  for (let j = 0; j < i; j += 1) {
    f = d[j];
    g = e[j];
    for (let k = j; k <= i - 1; k += 1) v[k][j] -= f * e[k] + g * d[k];
    d[j] = v[i - 1][j];
    v[i][j] = 0;
  }
  return h;
}

/** Accumulates the Householder transformations of tred2 into V. */
function accumulate(v: Matrix, d: number[]): void {
  const n = v.length;
  for (let i = 0; i < n - 1; i += 1) {
    v[n - 1][i] = v[i][i];
    v[i][i] = 1;
    const h = d[i + 1];
    if (h !== 0) {
      for (let k = 0; k <= i; k += 1) d[k] = v[k][i + 1] / h;
      for (let j = 0; j <= i; j += 1) {
        let g = 0;
        for (let k = 0; k <= i; k += 1) g += v[k][i + 1] * v[k][j];
        for (let k = 0; k <= i; k += 1) v[k][j] -= g * d[k];
      }
    }
    for (let k = 0; k <= i; k += 1) v[k][i + 1] = 0;
  }
  for (let j = 0; j < n; j += 1) {
    d[j] = v[n - 1][j];
    v[n - 1][j] = 0;
  }
  v[n - 1][n - 1] = 1;
}

/** The QL method with implicit shifts on the tridiagonal (d, e), accumulating rotations into V. */
function tql2(v: Matrix, d: number[], e: number[]): void {
  const n = v.length;
  for (let i = 1; i < n; i += 1) e[i - 1] = e[i];
  e[n - 1] = 0;
  let f = 0;
  let tst1 = 0;
  for (let l = 0; l < n; l += 1) {
    tst1 = Math.max(tst1, Math.abs(d[l]) + Math.abs(e[l]));
    let m = l;
    while (m < n && Math.abs(e[m]) > EPS * tst1) m += 1;
    if (m > l) {
      let iter = 0;
      do {
        iter += 1;
        if (iter > 60) throw new NumError('noConvergence', 'symmetric eigenvalues');
        f += qlStep(v, d, e, l, m);
      } while (Math.abs(e[l]) > EPS * tst1);
    }
    d[l] += f;
    e[l] = 0;
  }
}

/** One implicit QL sweep on rows l..m; returns the shift it applied. */
function qlStep(v: Matrix, d: number[], e: number[], l: number, m: number): number {
  const n = v.length;
  let g = d[l];
  let p = (d[l + 1] - g) / (2 * e[l]);
  let r = hypot(p, 1);
  if (p < 0) r = -r;
  d[l] = e[l] / (p + r);
  d[l + 1] = e[l] * (p + r);
  const dl1 = d[l + 1];
  let h = g - d[l];
  for (let i = l + 2; i < n; i += 1) d[i] -= h;
  const shift = h;
  p = d[m];
  let c = 1;
  let c2 = c;
  let c3 = c;
  const el1 = e[l + 1];
  let s = 0;
  let s2 = 0;
  for (let i = m - 1; i >= l; i -= 1) {
    c3 = c2;
    c2 = c;
    s2 = s;
    g = c * e[i];
    h = c * p;
    r = hypot(p, e[i]);
    e[i + 1] = s * r;
    s = e[i] / r;
    c = p / r;
    p = c * d[i] - s * g;
    d[i + 1] = h + s * (c * g + s * d[i]);
    for (let k = 0; k < n; k += 1) {
      h = v[k][i + 1];
      v[k][i + 1] = s * v[k][i] + c * h;
      v[k][i] = c * v[k][i] - s * h;
    }
  }
  p = (-s * s2 * c3 * el1 * e[l]) / dl1;
  e[l] = s * p;
  d[l] = c * p;
  return shift;
}

/** Eigenvalues (ascending) and orthonormal eigenvectors of a symmetric matrix. Only the lower triangle is read. */
export function eigSymmetric(a: MatrixLike): SymmetricEigen {
  const n = a.length;
  const v = clone(a);
  for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) v[i][j] = v[j][i];
  const d = new Array<number>(n).fill(0);
  const e = new Array<number>(n).fill(0);
  tred2(v, d, e);
  tql2(v, d, e);
  const order = d.map((_, i) => i).sort((x, y) => d[x] - d[y]);
  return { values: order.map((i) => d[i]), vectors: v.map((row) => order.map((j) => row[j])) };
}
