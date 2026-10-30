// Floating-point eigenvalues and singular values for small matrices: the eigenvalues of any real square matrix by the
// shifted QR algorithm, a symmetric matrix by Jacobi rotations (orthonormal vectors), and the singular value
// decomposition by one-sided Jacobi, which keeps small singular values accurate. Written for clarity: sizes are small.
import { abs as cabs, add, c, conj, mul, scale, sqrt as csqrt, sub, type C } from './complex/cmath';
import type { Mat } from './dense';

/** Reduces a square matrix to upper Hessenberg form by Householder reflections (a similarity, so same eigenvalues). */
export function hessenberg(A: Mat): Mat {
  const n = A.length;
  const H = A.map((row) => row.slice());
  for (let k = 0; k < n - 2; k++) {
    let alpha = 0;
    for (let i = k + 1; i < n; i++) alpha += H[i][k] * H[i][k];
    alpha = Math.sqrt(alpha);
    if (alpha < 1e-300) continue;
    if (H[k + 1][k] > 0) alpha = -alpha;
    const v = new Array<number>(n).fill(0);
    for (let i = k + 1; i < n; i++) v[i] = H[i][k];
    v[k + 1] -= alpha;
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    if (norm < 1e-300) continue;
    for (let i = 0; i < n; i++) v[i] /= norm;
    // Apply the reflector from the left, then from the right.
    for (let j = 0; j < n; j++) {
      let dot = 0;
      for (let i = k + 1; i < n; i++) dot += v[i] * H[i][j];
      for (let i = k + 1; i < n; i++) H[i][j] -= 2 * v[i] * dot;
    }
    for (let i = 0; i < n; i++) {
      let dot = 0;
      for (let j = k + 1; j < n; j++) dot += H[i][j] * v[j];
      for (let j = k + 1; j < n; j++) H[i][j] -= 2 * dot * v[j];
    }
  }
  return H;
}

/** All eigenvalues of a real square matrix, as complex numbers, in no particular order. Null if the iteration fails. */
export function eigenvalues(A: Mat): C[] | null {
  const n = A.length;
  if (n === 0) return [];
  const H: C[][] = hessenberg(A).map((row) => row.map((v) => c(v)));
  const out: C[] = new Array<C>(n);
  let hi = n - 1;
  let iter = 0;
  const eps = 2.2e-16;
  while (hi >= 0) {
    if (hi === 0) {
      out[0] = H[0][0];
      break;
    }
    let l = hi;
    while (l > 0) {
      const small = eps * (cabs(H[l - 1][l - 1]) + cabs(H[l][l]) || 1);
      if (cabs(H[l][l - 1]) <= small) break;
      l--;
    }
    if (l === hi) {
      out[hi] = H[hi][hi];
      hi--;
      iter = 0;
      continue;
    }
    if (l > 0) H[l][l - 1] = c(0);
    if (++iter > 300) return null;
    // Wilkinson shift: the eigenvalue of the trailing 2 x 2 block nearer its last entry.
    const a = H[hi - 1][hi - 1];
    const b = H[hi - 1][hi];
    const cc = H[hi][hi - 1];
    const d = H[hi][hi];
    const half = scale(sub(a, d), 0.5);
    const disc = csqrt(add(mul(half, half), mul(b, cc)));
    const m1 = add(scale(add(a, d), 0.5), disc);
    const m2 = sub(scale(add(a, d), 0.5), disc);
    let mu = cabs(sub(m1, d)) < cabs(sub(m2, d)) ? m1 : m2;
    if (iter % 11 === 10) mu = add(d, c(cabs(cc), 0));
    for (let k = l; k <= hi; k++) H[k][k] = sub(H[k][k], mu);
    const rotations: { cs: C; sn: C }[] = [];
    for (let k = l; k < hi; k++) {
      const x = H[k][k];
      const y = H[k + 1][k];
      const r = Math.hypot(cabs(x), cabs(y));
      const cs = r === 0 ? c(1) : scale(x, 1 / r);
      const sn = r === 0 ? c(0) : scale(y, 1 / r);
      rotations.push({ cs, sn });
      for (let j = k; j <= hi; j++) {
        const p = H[k][j];
        const q = H[k + 1][j];
        H[k][j] = add(mul(conj(cs), p), mul(conj(sn), q));
        H[k + 1][j] = add(scale(mul(sn, p), -1), mul(cs, q));
      }
    }
    for (let k = l; k < hi; k++) {
      const { cs, sn } = rotations[k - l];
      for (let i = l; i <= Math.min(k + 2, hi); i++) {
        const p = H[i][k];
        const q = H[i][k + 1];
        H[i][k] = add(mul(p, cs), mul(q, sn));
        H[i][k + 1] = add(scale(mul(p, conj(sn)), -1), mul(q, conj(cs)));
      }
    }
    for (let k = l; k <= hi; k++) H[k][k] = add(H[k][k], mu);
  }
  // A real matrix has conjugate pairs: tidy the tiny imaginary parts of the real eigenvalues.
  const scaleOf = Math.max(1e-300, ...out.map(cabs));
  return out.map((z) => (Math.abs(z.im) <= 1e-10 * scaleOf ? c(z.re) : z));
}

/** Eigenvalues in a stable order: by real part, then by imaginary part. */
export const sortEigenvalues = (values: readonly C[]): C[] =>
  values
    .slice()
    .sort((p, q) => (Math.abs(p.re - q.re) > 1e-9 * Math.max(1, Math.abs(p.re)) ? p.re - q.re : p.im - q.im));

/** The eigenvalues and orthonormal eigenvectors (columns) of a symmetric matrix by cyclic Jacobi rotations. */
export function symmetricEigen(S: Mat): { values: number[]; vectors: Mat } {
  const n = S.length;
  const A = S.map((row) => row.slice());
  const V: Mat = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] * A[i][j];
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-300) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const cs = 1 / Math.sqrt(t * t + 1);
        const sn = t * cs;
        for (let k = 0; k < n; k++) {
          const akp = A[k][p];
          const akq = A[k][q];
          A[k][p] = cs * akp - sn * akq;
          A[k][q] = sn * akp + cs * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p][k];
          const aqk = A[q][k];
          A[p][k] = cs * apk - sn * aqk;
          A[q][k] = sn * apk + cs * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p];
          const vkq = V[k][q];
          V[k][p] = cs * vkp - sn * vkq;
          V[k][q] = sn * vkp + cs * vkq;
        }
      }
    }
  }
  const order = A.map((_, i) => i).sort((i, j) => A[i][i] - A[j][j]);
  return { values: order.map((i) => A[i][i]), vectors: V.map((row) => order.map((j) => row[j])) };
}

export interface Svd {
  /** m x k with orthonormal columns (k = min(m, n)). */
  U: Mat;
  /** Singular values, largest first. */
  S: number[];
  /** n x k with orthonormal columns. */
  V: Mat;
}

/** The thin singular value decomposition A = U diag(S) V^T by one-sided Jacobi rotations. */
export function svd(A: Mat): Svd {
  const m = A.length;
  const n = A[0].length;
  if (m < n) {
    const t = svd(A[0].map((_, j) => A.map((row) => row[j])));
    return { U: t.V, S: t.S, V: t.U };
  }
  const W = A.map((row) => row.slice());
  const V: Mat = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 60; sweep++) {
    let rotated = false;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        let alpha = 0;
        let beta = 0;
        let gamma = 0;
        for (let i = 0; i < m; i++) {
          alpha += W[i][p] * W[i][p];
          beta += W[i][q] * W[i][q];
          gamma += W[i][p] * W[i][q];
        }
        if (Math.abs(gamma) <= 1e-15 * Math.sqrt(alpha * beta) || gamma === 0) continue;
        rotated = true;
        const zeta = (beta - alpha) / (2 * gamma);
        const t = Math.sign(zeta || 1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        const cs = 1 / Math.sqrt(1 + t * t);
        const sn = cs * t;
        for (let i = 0; i < m; i++) {
          const wp = W[i][p];
          const wq = W[i][q];
          W[i][p] = cs * wp - sn * wq;
          W[i][q] = sn * wp + cs * wq;
        }
        for (let i = 0; i < n; i++) {
          const vp = V[i][p];
          const vq = V[i][q];
          V[i][p] = cs * vp - sn * vq;
          V[i][q] = sn * vp + cs * vq;
        }
      }
    }
    if (!rotated) break;
  }
  const norms = Array.from({ length: n }, (_, j) => Math.sqrt(W.reduce((s, row) => s + row[j] * row[j], 0)));
  const order = norms.map((_, j) => j).sort((i, j) => norms[j] - norms[i]);
  const S = order.map((j) => norms[j]);
  const U = W.map((row) => order.map((j, k) => (S[k] > 1e-300 ? row[j] / norms[j] : 0)));
  return { U, S, V: V.map((row) => order.map((j) => row[j])) };
}

/** A unit eigenvector of a real eigenvalue by inverse iteration, or null when the matrix cannot be solved. */
export function realEigenvector(A: Mat, lambda: number): number[] | null {
  const n = A.length;
  const scaleOf = Math.max(1, ...A.map((row) => row.reduce((s, v) => s + Math.abs(v), 0)));
  const shift = lambda + 1e-10 * scaleOf;
  const M = A.map((row, i) => row.map((v, j) => (i === j ? v - shift : v)));
  let x = Array.from({ length: n }, (_, i) => 1 + i * 0.37);
  for (let it = 0; it < 6; it++) {
    const y = solveLU(M, x);
    if (!y) return null;
    const norm = Math.sqrt(y.reduce((s, v) => s + v * v, 0));
    if (!(norm > 0) || !Number.isFinite(norm)) return null;
    x = y.map((v) => v / norm);
  }
  const big = x.reduce((best, v) => (Math.abs(v) > Math.abs(best) ? v : best), 0);
  return x.map((v) => (big < 0 ? -v : v));
}

function solveLU(A: Mat, b: readonly number[]): number[] | null {
  const n = A.length;
  const m = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (m[pivot][col] === 0) m[pivot][col] = 1e-300;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = col + 1; r < n; r++) {
      const f = m[r][col] / m[col][col];
      for (let k = col; k <= n; k++) m[r][k] -= f * m[col][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r][n];
    for (let k = r + 1; k < n; k++) s -= m[r][k] * x[k];
    x[r] = s / m[r][r];
  }
  return x.every(Number.isFinite) ? x : null;
}

/** The spectral radius: the largest absolute value of an eigenvalue. */
export function spectralRadius(A: Mat): number {
  const values = eigenvalues(A);
  return values ? Math.max(0, ...values.map(cabs)) : NaN;
}
