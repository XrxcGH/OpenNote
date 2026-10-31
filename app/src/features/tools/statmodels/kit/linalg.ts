// The linear algebra the models need, on plain arrays of rows. Least squares is by Householder QR, which keeps
// rounding small when predictors are nearly collinear. The inverse is by Gauss-Jordan with partial pivoting. The
// eigenvalues and vectors of a symmetric matrix come from cyclic Jacobi rotations.
import { fail } from './types';

export type Matrix = number[][];

export const zeros = (rows: number, cols: number): Matrix =>
  Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

export const identity = (n: number): Matrix => zeros(n, n).map((row, i) => row.map((_, j) => (i === j ? 1 : 0)));

export const transpose = (a: Matrix): Matrix => (a.length === 0 ? [] : a[0].map((_, j) => a.map((row) => row[j])));

export function matMul(a: Matrix, b: Matrix): Matrix {
  const n = a.length;
  const m = b[0]?.length ?? 0;
  const out = zeros(n, m);
  for (let i = 0; i < n; i += 1)
    for (let k = 0; k < b.length; k += 1) {
      const aik = a[i][k];
      if (aik === 0) continue;
      for (let j = 0; j < m; j += 1) out[i][j] += aik * b[k][j];
    }
  return out;
}

export const matVec = (a: Matrix, x: readonly number[]): number[] => a.map((row) => dot(row, x));

export function dot(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
}

/** X'WX for a design X and weights w (all 1 when w is left out). */
export function crossprod(x: Matrix, w?: readonly number[]): Matrix {
  const p = x[0]?.length ?? 0;
  const out = zeros(p, p);
  x.forEach((row, i) => {
    const wi = w ? w[i] : 1;
    for (let a = 0; a < p; a += 1) {
      const v = wi * row[a];
      if (v === 0) continue;
      for (let b = a; b < p; b += 1) out[a][b] += v * row[b];
    }
  });
  for (let a = 0; a < p; a += 1) for (let b = 0; b < a; b += 1) out[a][b] = out[b][a];
  return out;
}

/** X'Wy. */
export function crossVec(x: Matrix, y: readonly number[], w?: readonly number[]): number[] {
  const p = x[0]?.length ?? 0;
  const out = new Array<number>(p).fill(0);
  x.forEach((row, i) => {
    const v = (w ? w[i] : 1) * y[i];
    for (let a = 0; a < p; a += 1) out[a] += row[a] * v;
  });
  return out;
}

/** The inverse, or null when the matrix is singular to working precision. */
export function inverse(a: Matrix): Matrix | null {
  const n = a.length;
  const m = a.map((row, i) => [...row, ...identity(n)[i]]);
  const scale = Math.max(1e-300, ...a.flat().map(Math.abs));
  for (let c = 0; c < n; c += 1) {
    let pivot = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(m[r][c]) > Math.abs(m[pivot][c])) pivot = r;
    if (Math.abs(m[pivot][c]) < 1e-13 * scale) return null;
    [m[c], m[pivot]] = [m[pivot], m[c]];
    const p = m[c][c];
    for (let j = 0; j < 2 * n; j += 1) m[c][j] /= p;
    for (let r = 0; r < n; r += 1) {
      if (r === c || m[r][c] === 0) continue;
      const f = m[r][c];
      for (let j = 0; j < 2 * n; j += 1) m[r][j] -= f * m[c][j];
    }
  }
  return m.map((row) => row.slice(n));
}

/** Solves A x = b, or returns null when A is singular. */
export function solve(a: Matrix, b: readonly number[]): number[] | null {
  const inv = inverse(a);
  return inv ? matVec(inv, b) : null;
}

/** The lower Cholesky factor of A (A is the factor times its transpose), or null when A is not positive definite. */
export function cholesky(a: Matrix): Matrix | null {
  const n = a.length;
  const l = zeros(n, n);
  for (let i = 0; i < n; i += 1)
    for (let j = 0; j <= i; j += 1) {
      let sum = a[i][j];
      for (let k = 0; k < j; k += 1) sum -= l[i][k] * l[j][k];
      if (i === j) {
        if (sum <= 0) return null;
        l[i][i] = Math.sqrt(sum);
      } else l[i][j] = sum / l[j][j];
    }
  return l;
}

export interface LeastSquares {
  readonly coef: number[];
  readonly fitted: number[];
  readonly resid: number[];
  /** (X'X)^-1, from R^-1 R^-T. */
  readonly xtxInv: Matrix;
  readonly rss: number;
}

/**
 * Least squares by Householder QR. It stops with `collinear` and the name of the first column that the others
 * already explain, since its coefficient could take any value.
 */
export function leastSquares(x: Matrix, y: readonly number[], names: readonly string[] = []): LeastSquares {
  const n = x.length;
  const p = x[0]?.length ?? 0;
  if (n <= p) fail('tooFewRows', `${n}|${p}`);
  const a = x.map((row) => [...row]);
  const qty = [...y];
  const norms = transpose(x).map((col) => Math.sqrt(dot(col, col)));
  for (let k = 0; k < p; k += 1) {
    let norm = 0;
    for (let i = k; i < n; i += 1) norm += a[i][k] ** 2;
    norm = Math.sqrt(norm);
    if (norm <= 1e-10 * Math.max(norms[k], 1e-300)) fail('collinear', names[k] ?? String(k + 1));
    const alpha = a[k][k] > 0 ? -norm : norm;
    const v = new Array<number>(n).fill(0);
    v[k] = a[k][k] - alpha;
    for (let i = k + 1; i < n; i += 1) v[i] = a[i][k];
    const vv = dot(v, v);
    if (vv === 0) continue;
    for (let j = k; j < p; j += 1) {
      let s = 0;
      for (let i = k; i < n; i += 1) s += v[i] * a[i][j];
      const f = (2 * s) / vv;
      for (let i = k; i < n; i += 1) a[i][j] -= f * v[i];
    }
    let s = 0;
    for (let i = k; i < n; i += 1) s += v[i] * qty[i];
    const f = (2 * s) / vv;
    for (let i = k; i < n; i += 1) qty[i] -= f * v[i];
  }
  const rInv = upperInverse(a.slice(0, p).map((row) => row.slice(0, p)));
  const coef = matVec(rInv, qty.slice(0, p));
  const fitted = matVec(x, coef);
  const resid = y.map((yi, i) => yi - fitted[i]);
  return { coef, fitted, resid, xtxInv: matMul(rInv, transpose(rInv)), rss: dot(resid, resid) };
}

function upperInverse(r: Matrix): Matrix {
  const p = r.length;
  const inv = zeros(p, p);
  for (let j = 0; j < p; j += 1) {
    inv[j][j] = 1 / r[j][j];
    for (let i = j - 1; i >= 0; i -= 1) {
      let s = 0;
      for (let k = i + 1; k <= j; k += 1) s += r[i][k] * inv[k][j];
      inv[i][j] = -s / r[i][i];
    }
  }
  return inv;
}

export interface Eigen {
  /** Largest first. */
  readonly values: number[];
  /** vectors[k] is the unit eigenvector of values[k]. */
  readonly vectors: number[][];
}

/** Eigenvalues and eigenvectors of a symmetric matrix by cyclic Jacobi rotations, to about 1e-14. */
export function symmetricEigen(input: Matrix): Eigen {
  const n = input.length;
  const a = input.map((row) => [...row]);
  const v = identity(n);
  for (let sweep = 0; sweep < 100; sweep += 1) {
    let off = 0;
    for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) off += a[i][j] ** 2;
    if (off < 1e-30 * Math.max(1, ...a.map((row, i) => row[i] ** 2))) break;
    for (let p = 0; p < n; p += 1) for (let q = p + 1; q < n; q += 1) rotate(a, v, p, q);
  }
  const order = a.map((_, i) => i).sort((i, j) => a[j][j] - a[i][i]);
  return {
    values: order.map((i) => a[i][i]),
    vectors: order.map((i) => {
      const vec = v.map((row) => row[i]);
      const lead = vec.reduce((best, x) => (Math.abs(x) > Math.abs(best) ? x : best), 0);
      return lead < 0 ? vec.map((x) => -x) : vec;
    }),
  };
}

function rotate(a: Matrix, v: Matrix, p: number, q: number): void {
  if (Math.abs(a[p][q]) < 1e-300) return;
  const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
  const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
  const c = 1 / Math.sqrt(t * t + 1);
  const s = t * c;
  const n = a.length;
  for (let k = 0; k < n; k += 1) {
    const akp = a[k][p];
    const akq = a[k][q];
    a[k][p] = c * akp - s * akq;
    a[k][q] = s * akp + c * akq;
  }
  for (let k = 0; k < n; k += 1) {
    const apk = a[p][k];
    const aqk = a[q][k];
    a[p][k] = c * apk - s * aqk;
    a[q][k] = s * apk + c * aqk;
  }
  for (let k = 0; k < n; k += 1) {
    const vkp = v[k][p];
    const vkq = v[k][q];
    v[k][p] = c * vkp - s * vkq;
    v[k][q] = s * vkp + c * vkq;
  }
}

export const mean = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;

export function variance(xs: readonly number[]): number {
  const m = mean(xs);
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
}

/** The middle value, or the mean of the middle two. */
export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const h = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[h] : (s[h - 1] + s[h]) / 2;
}
