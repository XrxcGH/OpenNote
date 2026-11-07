// Eigenvalues and eigenvectors of any real square matrix: the symmetric path (tred2/tql2) when the matrix is
// symmetric, otherwise Hessenberg reduction, and the double QR iteration (orthes/hqr2). Complex eigenvalues come with
// complex eigenvectors. The generalized symmetric problem K x = λ M x (M positive definite) reduces by Cholesky.
import type { Complex } from '../complex';
import { cabs, cx } from '../complex';
import { NumError } from '../errors';
import { checked, clone, isSymmetric, transpose } from './basic';
import type { Matrix, MatrixLike } from './basic';
import { cholesky } from './cholesky';
import { eigSymmetric } from './eigSym';
import { orthes } from './hessenberg';
import { hqr2 } from './hqr2';

export interface Eigen {
  /** The eigenvalues, ordered by real part (largest first), then imaginary part (largest first). */
  values: Complex[];
  /** values[k]'s eigenvector, scaled to unit length with its largest entry real and positive. */
  vectors: Complex[][];
  /** Whether every eigenvalue is real. */
  real: boolean;
}

export function eig(input: MatrixLike): Eigen {
  const a = checked(input, true);
  const n = a.length;
  if (isSymmetric(a)) {
    const sym = eigSymmetric(a);
    const order = sym.values.map((_, i) => i).reverse();
    return {
      values: order.map((i) => cx(sym.values[i])),
      vectors: order.map((i) => normalize(sym.vectors.map((row) => cx(row[i])))),
      real: true,
    };
  }
  const h = clone(a);
  const v = orthes(h);
  const { d, e } = hqr2(h, v);
  const pairs: { value: Complex; vector: Complex[] }[] = [];
  for (let j = 0; j < n; j += 1) {
    if (e[j] === 0) pairs.push({ value: cx(d[j]), vector: v.map((row) => cx(row[j])) });
    else if (e[j] > 0) {
      const plus = v.map((row) => cx(row[j], row[j + 1]));
      pairs.push({ value: cx(d[j], e[j]), vector: plus });
      pairs.push({ value: cx(d[j], -e[j]), vector: plus.map((z) => cx(z.re, -z.im)) });
    }
  }
  pairs.sort((x, y) => y.value.re - x.value.re || y.value.im - x.value.im);
  return {
    values: pairs.map((pair) => pair.value),
    vectors: pairs.map((pair) => normalize(pair.vector)),
    real: e.every((x) => x === 0),
  };
}

/** Scales a complex vector to unit length and turns it so its largest entry is real and positive. */
function normalize(vector: readonly Complex[]): Complex[] {
  const length = Math.hypot(...vector.map(cabs));
  if (length === 0) return vector.map((z) => cx(z.re, z.im));
  let big = vector[0];
  for (const z of vector) if (cabs(z) > cabs(big) * (1 + 1e-12)) big = z;
  const turn = cx(big.re / cabs(big), -big.im / cabs(big));
  return vector.map((z) => {
    const re = (z.re * turn.re - z.im * turn.im) / length;
    const im = (z.re * turn.im + z.im * turn.re) / length;
    return cx(re, Math.abs(im) < 1e-15 ? 0 : im);
  });
}

export interface GeneralizedEigen {
  /** λ, smallest first. */
  values: number[];
  /** Columns x with xᵀ M x = 1 (mass-normalized). */
  vectors: Matrix;
}

/** Solves K x = λ M x for symmetric K and symmetric positive definite M, as in vibration modes. */
export function eigGeneralizedSymmetric(kInput: MatrixLike, mInput: MatrixLike): GeneralizedEigen {
  const k = checked(kInput, true);
  const m = checked(mInput, true);
  if (k.length !== m.length) throw new NumError('shape');
  if (!isSymmetric(k) || !isSymmetric(m)) throw new NumError('notSymmetric');
  const { l, spd } = cholesky(m);
  if (!spd) throw new NumError('notPositiveDefinite');
  const n = k.length;
  // C = L⁻¹ K L⁻ᵀ, by forward substitution on the columns and then on the rows.
  const y = forward(l, k);
  const c = forward(l, transpose(y));
  for (let i = 0; i < n; i += 1) for (let j = 0; j < i; j += 1) c[i][j] = c[j][i] = (c[i][j] + c[j][i]) / 2;
  const sym = eigSymmetric(c);
  // x = L⁻ᵀ y.
  const x = backward(l, sym.vectors);
  return { values: sym.values, vectors: x };
}

/** L⁻¹ B for lower triangular L. */
function forward(l: Matrix, b: MatrixLike): Matrix {
  const out = clone(b);
  const n = l.length;
  for (let j = 0; j < out[0].length; j += 1)
    for (let i = 0; i < n; i += 1) {
      let s = out[i][j];
      for (let k = 0; k < i; k += 1) s -= l[i][k] * out[k][j];
      out[i][j] = s / l[i][i];
    }
  return out;
}

/** L⁻ᵀ B for lower triangular L. */
function backward(l: Matrix, b: MatrixLike): Matrix {
  const out = clone(b);
  const n = l.length;
  for (let j = 0; j < out[0].length; j += 1)
    for (let i = n - 1; i >= 0; i -= 1) {
      let s = out[i][j];
      for (let k = i + 1; k < n; k += 1) s -= l[k][i] * out[k][j];
      out[i][j] = s / l[i][i];
    }
  return out;
}
