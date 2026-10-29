// The kits' dense linear algebra: a TypeScript port of JAMA (public domain, NIST, and The MathWorks) with the
// functions engineering courses need on top: solve, inverse, determinant, rank, null space, pseudo-inverse,
// condition number, the matrix exponential, and Lyapunov and Sylvester equations. Inputs are arrays of rows and are
// never changed. Errors throw NumError with a code a tool turns into words.
import { NumError } from '../errors';
import {
  add,
  checked,
  cols,
  identity,
  kron,
  multiply,
  norm1,
  rows,
  scale,
  transpose,
  unvec,
  vec,
  zeros,
} from './basic';
import type { Matrix, MatrixLike } from './basic';
import { luDecompose, luDeterminant, luSolve } from './lu';
import { qrDecompose, qrSolve } from './qr';
import { svd } from './svd';

export * from './basic';
export { luDecompose, luDeterminant, luL, luSolve, luU } from './lu';
export type { Lu } from './lu';
export { qrDecompose, qrQ, qrR, qrSolve } from './qr';
export type { Qr } from './qr';
export { cholesky, choleskySolve } from './cholesky';
export type { Cholesky } from './cholesky';
export { eigSymmetric } from './eigSym';
export type { SymmetricEigen } from './eigSym';
export { eig, eigGeneralizedSymmetric } from './eig';
export type { Eigen, GeneralizedEigen } from './eig';
export { svd } from './svd';
export type { Svd } from './svd';

const EPS = 2 ** -52;

/** Solves AX = B: LU for a square A, least squares by QR for a tall one. */
export function solve(aInput: MatrixLike, bInput: MatrixLike): Matrix {
  const a = checked(aInput);
  const b = checked(bInput);
  if (rows(b) !== rows(a)) throw new NumError('shape');
  if (rows(a) === cols(a)) return luSolve(luDecompose(a), b);
  if (rows(a) > cols(a)) return qrSolve(qrDecompose(a), b);
  throw new NumError('shape', 'more unknowns than equations: use the pseudo-inverse');
}

export function inverse(input: MatrixLike): Matrix {
  const a = checked(input, true);
  return luSolve(luDecompose(a), identity(a.length));
}

export function det(input: MatrixLike): number {
  const a = checked(input, true);
  return luDeterminant(luDecompose(a));
}

/** The tolerance below which a singular value counts as zero: max(m, n) · eps · σ₁. */
const svdTol = (a: MatrixLike, s: readonly number[]) => Math.max(rows(a), cols(a)) * EPS * (s[0] ?? 0);

export function rank(input: MatrixLike): number {
  const a = checked(input);
  const { s } = svd(a);
  const tol = svdTol(a, s);
  return s.filter((x) => x > tol).length;
}

/** The 2-norm condition number σ₁/σₙ; Infinity when A is singular. */
export function cond(input: MatrixLike): number {
  const a = checked(input);
  const { s } = svd(a);
  const last = s[s.length - 1];
  return last <= svdTol(a, s) ? Infinity : s[0] / last;
}

/** An orthonormal basis of the null space of A, as columns (n by k). Empty columns (n by 0) when it is {0}. */
export function nullSpace(input: MatrixLike): Matrix {
  const a = checked(input);
  const n = cols(a);
  // Zero rows leave the null space alone and make A at least square, so V comes out complete.
  const padded = rows(a) >= n ? a : [...a, ...zeros(n - rows(a), n)];
  const { s, v } = svd(padded);
  const tol = svdTol(a, s);
  const keep = s.map((x, j) => (x <= tol ? j : -1)).filter((j) => j >= 0);
  return v.map((row) => keep.map((j) => row[j]));
}

/** The Moore-Penrose pseudo-inverse V S⁺ Uᵀ (n by m). */
export function pinv(input: MatrixLike): Matrix {
  const a = checked(input);
  const { u, s, v } = svd(a);
  const tol = svdTol(a, s);
  const vs = v.map((row) => row.map((x, j) => (s[j] > tol ? x / s[j] : 0)));
  return multiply(vs, transpose(u));
}

const PADE13 = [
  64764752532480000, 32382376266240000, 7771770303897600, 1187353796428800, 129060195264000, 10559470521600,
  670442572800, 33522128640, 1323241920, 40840800, 960960, 16380, 182, 1,
];
const THETA13 = 5.371920351148152;

/** e^A by the [13/13] Padé approximant with scaling and squaring (Higham 2005). */
export function expm(input: MatrixLike): Matrix {
  const a0 = checked(input, true);
  const n = a0.length;
  const norm = norm1(a0);
  const squarings = norm > THETA13 ? Math.max(0, Math.ceil(Math.log2(norm / THETA13))) : 0;
  const a = scale(a0, 2 ** -squarings);
  const b = PADE13;
  const i = identity(n);
  const a2 = multiply(a, a);
  const a4 = multiply(a2, a2);
  const a6 = multiply(a4, a2);
  const sum = (terms: [number, Matrix][]) => terms.reduce((acc, [k, m]) => add(acc, scale(m, k)), zeros(n));
  const uInner = add(
    multiply(
      a6,
      sum([
        [b[13], a6],
        [b[11], a4],
        [b[9], a2],
      ]),
    ),
    sum([
      [b[7], a6],
      [b[5], a4],
      [b[3], a2],
      [b[1], i],
    ]),
  );
  const u = multiply(a, uInner);
  const v = add(
    multiply(
      a6,
      sum([
        [b[12], a6],
        [b[10], a4],
        [b[8], a2],
      ]),
    ),
    sum([
      [b[6], a6],
      [b[4], a4],
      [b[2], a2],
      [b[0], i],
    ]),
  );
  let r = luSolve(luDecompose(add(v, u, -1)), add(v, u));
  for (let k = 0; k < squarings; k += 1) r = multiply(r, r);
  return r;
}

/** The largest order the Kronecker-form equation solvers take (n² unknowns). */
export const MAX_KRONECKER = 12;

/** Solves A X + X B = C for X (MATLAB's sylvester(A, B, C)). */
export function sylvester(aInput: MatrixLike, bInput: MatrixLike, cInput: MatrixLike): Matrix {
  const a = checked(aInput, true);
  const b = checked(bInput, true);
  const c = checked(cInput);
  const n = a.length;
  const m = b.length;
  if (rows(c) !== n || cols(c) !== m) throw new NumError('shape');
  if (n > MAX_KRONECKER || m > MAX_KRONECKER) throw new NumError('tooLarge');
  // vec(AX) = (I ⊗ A) vec X and vec(XB) = (Bᵀ ⊗ I) vec X.
  const system = add(kron(identity(m), a), kron(transpose(b), identity(n)));
  const x = luSolve(
    luDecompose(system),
    vec(c).map((value) => [value]),
  );
  return unvec(
    x.map((row) => row[0]),
    n,
    m,
  );
}

/** Solves the continuous Lyapunov equation A X + X Aᵀ + Q = 0 (MATLAB's lyap(A, Q)). */
export function lyap(a: MatrixLike, q: MatrixLike): Matrix {
  return sylvester(a, transpose(a), scale(q, -1));
}

/** Solves the discrete Lyapunov equation A X Aᵀ - X + Q = 0 (MATLAB's dlyap(A, Q)). */
export function dlyap(aInput: MatrixLike, qInput: MatrixLike): Matrix {
  const a = checked(aInput, true);
  const q = checked(qInput, true);
  const n = a.length;
  if (q.length !== n) throw new NumError('shape');
  if (n > MAX_KRONECKER) throw new NumError('tooLarge');
  // vec(A X Aᵀ) = (A ⊗ A) vec X.
  const system = add(kron(a, a), identity(n * n), -1);
  const x = luSolve(
    luDecompose(system),
    vec(q).map((value) => [-value]),
  );
  return unvec(
    x.map((row) => row[0]),
    n,
    n,
  );
}
