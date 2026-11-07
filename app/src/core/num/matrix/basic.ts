// Dense real matrices as arrays of rows, and the plain operations the decompositions build on: shapes, copies,
// products, sums, norms, and the Kronecker product. Inputs are never changed; every function returns a new matrix.
import { NumError, ensure } from '../errors';

export type Matrix = number[][];
export type MatrixLike = readonly (readonly number[])[];

/** The largest matrix the kit tools work on, so a paste cannot stall the window. */
export const MAX_ORDER = 60;

export const rows = (a: MatrixLike): number => a.length;
export const cols = (a: MatrixLike): number => (a.length === 0 ? 0 : a[0].length);

export const zeros = (m: number, n = m): Matrix => Array.from({ length: m }, () => new Array<number>(n).fill(0));

export function identity(n: number): Matrix {
  const out = zeros(n);
  for (let i = 0; i < n; i += 1) out[i][i] = 1;
  return out;
}

export const clone = (a: MatrixLike): Matrix => a.map((row) => [...row]);

/** Checks that `a` is a non-empty rectangle of finite numbers no larger than MAX_ORDER, and returns a copy. */
export function checked(a: MatrixLike, square = false): Matrix {
  ensure(a.length > 0 && a[0].length > 0, 'empty');
  const n = a[0].length;
  ensure(
    a.every((row) => row.length === n),
    'shape',
    'rows differ in length',
  );
  ensure(a.length <= MAX_ORDER && n <= MAX_ORDER, 'tooLarge');
  ensure(
    a.every((row) => row.every(Number.isFinite)),
    'notFinite',
  );
  if (square) ensure(a.length === n, 'notSquare');
  return clone(a);
}

export function transpose(a: MatrixLike): Matrix {
  const m = rows(a);
  const n = cols(a);
  const out = zeros(n, m);
  for (let i = 0; i < m; i += 1) for (let j = 0; j < n; j += 1) out[j][i] = a[i][j];
  return out;
}

export function multiply(a: MatrixLike, b: MatrixLike): Matrix {
  if (cols(a) !== rows(b)) throw new NumError('shape', `${rows(a)}x${cols(a)} times ${rows(b)}x${cols(b)}`);
  const m = rows(a);
  const n = cols(b);
  const inner = cols(a);
  const out = zeros(m, n);
  for (let i = 0; i < m; i += 1) {
    for (let k = 0; k < inner; k += 1) {
      const aik = a[i][k];
      if (aik === 0) continue;
      for (let j = 0; j < n; j += 1) out[i][j] += aik * b[k][j];
    }
  }
  return out;
}

/** a + sign·b. */
export function add(a: MatrixLike, b: MatrixLike, sign = 1): Matrix {
  if (rows(a) !== rows(b) || cols(a) !== cols(b)) throw new NumError('shape');
  return a.map((row, i) => row.map((x, j) => x + sign * b[i][j]));
}

export const scale = (a: MatrixLike, k: number): Matrix => a.map((row) => row.map((x) => x * k));

export function multiplyVector(a: MatrixLike, x: readonly number[]): number[] {
  if (cols(a) !== x.length) throw new NumError('shape');
  return a.map((row) => row.reduce((sum, v, j) => sum + v * x[j], 0));
}

/** The largest column sum of absolute values. */
export function norm1(a: MatrixLike): number {
  let best = 0;
  for (let j = 0; j < cols(a); j += 1)
    best = Math.max(
      best,
      a.reduce((sum, row) => sum + Math.abs(row[j]), 0),
    );
  return best;
}

/** The largest row sum of absolute values. */
export const normInf = (a: MatrixLike): number =>
  a.reduce(
    (best, row) =>
      Math.max(
        best,
        row.reduce((sum, x) => sum + Math.abs(x), 0),
      ),
    0,
  );

/** The Frobenius norm, by hypot so it never overflows. */
export const normF = (a: MatrixLike): number => a.reduce((acc, row) => row.reduce((s, x) => Math.hypot(s, x), acc), 0);

/** The Kronecker product a ⊗ b. */
export function kron(a: MatrixLike, b: MatrixLike): Matrix {
  const p = rows(b);
  const q = cols(b);
  const out = zeros(rows(a) * p, cols(a) * q);
  a.forEach((row, i) =>
    row.forEach((aij, j) => {
      for (let k = 0; k < p; k += 1) for (let l = 0; l < q; l += 1) out[i * p + k][j * q + l] = aij * b[k][l];
    }),
  );
  return out;
}

/** The columns of `a` stacked into one vector (column-major order). */
export function vec(a: MatrixLike): number[] {
  const out: number[] = [];
  for (let j = 0; j < cols(a); j += 1) for (let i = 0; i < rows(a); i += 1) out.push(a[i][j]);
  return out;
}

/** The inverse of vec: an m by n matrix from a column-major vector. */
export function unvec(v: readonly number[], m: number, n: number): Matrix {
  const out = zeros(m, n);
  for (let j = 0; j < n; j += 1) for (let i = 0; i < m; i += 1) out[i][j] = v[j * m + i];
  return out;
}

export const column = (a: MatrixLike, j: number): number[] => a.map((row) => row[j]);

export const isSymmetric = (a: MatrixLike, tol = 1e-12): boolean => {
  const size = Math.max(1, normInf(a));
  return a.every((row, i) => row.every((x, j) => Math.abs(x - a[j][i]) <= tol * size));
};

/** sqrt(a² + b²) without overflow or underflow. */
export const hypot = (a: number, b: number): number => Math.hypot(a, b);
