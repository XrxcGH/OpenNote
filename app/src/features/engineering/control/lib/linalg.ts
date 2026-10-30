// Small dense matrices for the control tools: products, inverses, ranks, the matrix exponential, the
// characteristic polynomial and the Lyapunov equation. Matrices are arrays of rows. Every routine is plain
// arithmetic on numbers; nothing here reads text.

export type Mat = number[][];
export type ReadonlyMat = readonly (readonly number[])[];

/** Why a matrix routine could not finish. The tools turn the code into words. */
export class MatError extends Error {
  constructor(readonly code: 'singular' | 'shape' | 'empty' | 'tooLarge' | 'noConverge') {
    super(code);
  }
}

export const zeros = (n: number, m: number): Mat => Array.from({ length: n }, () => new Array<number>(m).fill(0));

export function eye(n: number): Mat {
  const out = zeros(n, n);
  for (let i = 0; i < n; i += 1) out[i][i] = 1;
  return out;
}

export const copy = (a: ReadonlyMat): Mat => a.map((row) => [...row]);
export const rows = (a: ReadonlyMat): number => a.length;
export const cols = (a: ReadonlyMat): number => (a.length ? a[0].length : 0);
export const transpose = (a: ReadonlyMat): Mat => Array.from({ length: cols(a) }, (_, j) => a.map((row) => row[j]));

export function mul(a: ReadonlyMat, b: ReadonlyMat): Mat {
  if (cols(a) !== rows(b)) throw new MatError('shape');
  const out = zeros(rows(a), cols(b));
  for (let i = 0; i < rows(a); i += 1)
    for (let k = 0; k < cols(a); k += 1) {
      const aik = a[i][k];
      if (aik === 0) continue;
      for (let j = 0; j < cols(b); j += 1) out[i][j] += aik * b[k][j];
    }
  return out;
}

export function add(a: ReadonlyMat, b: ReadonlyMat, sb = 1): Mat {
  if (rows(a) !== rows(b) || cols(a) !== cols(b)) throw new MatError('shape');
  return a.map((row, i) => row.map((x, j) => x + sb * b[i][j]));
}

export const scale = (a: ReadonlyMat, k: number): Mat => a.map((row) => row.map((x) => k * x));

/** The 1-norm: the largest column sum of absolute values. */
export function norm1(a: ReadonlyMat): number {
  let best = 0;
  for (let j = 0; j < cols(a); j += 1) {
    let sum = 0;
    for (let i = 0; i < rows(a); i += 1) sum += Math.abs(a[i][j]);
    best = Math.max(best, sum);
  }
  return best;
}

/** The largest absolute entry. */
export const normMax = (a: ReadonlyMat): number => Math.max(0, ...a.map((row) => Math.max(0, ...row.map(Math.abs))));

/** Solves A X = B by Gaussian elimination with partial pivoting. Throws 'singular' for a singular A. */
export function solve(a: ReadonlyMat, b: ReadonlyMat): Mat {
  const n = rows(a);
  if (n === 0) throw new MatError('empty');
  if (cols(a) !== n || rows(b) !== n) throw new MatError('shape');
  const m = cols(b);
  const aug = a.map((row, i) => [...row, ...b[i]]);
  const tol = 1e-13 * Math.max(1, normMax(a));
  for (let c = 0; c < n; c += 1) {
    let p = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(aug[r][c]) > Math.abs(aug[p][c])) p = r;
    if (Math.abs(aug[p][c]) <= tol) throw new MatError('singular');
    [aug[c], aug[p]] = [aug[p], aug[c]];
    for (let r = 0; r < n; r += 1) {
      if (r === c) continue;
      const f = aug[r][c] / aug[c][c];
      if (f === 0) continue;
      for (let k = c; k < n + m; k += 1) aug[r][k] -= f * aug[c][k];
    }
  }
  return aug.map((row, i) => row.slice(n).map((x) => x / aug[i][i]));
}

export const inv = (a: ReadonlyMat): Mat => solve(a, eye(rows(a)));

/** The determinant by elimination with partial pivoting. */
export function det(a: ReadonlyMat): number {
  const n = rows(a);
  if (cols(a) !== n) throw new MatError('shape');
  const m = copy(a);
  let d = 1;
  for (let c = 0; c < n; c += 1) {
    let p = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (m[p][c] === 0) return 0;
    if (p !== c) {
      [m[c], m[p]] = [m[p], m[c]];
      d = -d;
    }
    d *= m[c][c];
    for (let r = c + 1; r < n; r += 1) {
      const f = m[r][c] / m[c][c];
      for (let k = c; k < n; k += 1) m[r][k] -= f * m[c][k];
    }
  }
  return d;
}

/** The numerical rank by elimination with full pivoting, with a tolerance relative to the largest entry. */
export function rank(a: ReadonlyMat, relTol = 1e-9): number {
  const m = copy(a);
  const n = rows(m);
  const k = cols(m);
  const tol = relTol * Math.max(1e-300, normMax(m));
  let r = 0;
  const used = new Array<boolean>(k).fill(false);
  for (let step = 0; step < Math.min(n, k); step += 1) {
    let bi = -1;
    let bj = -1;
    let best = tol;
    for (let i = r; i < n; i += 1)
      for (let j = 0; j < k; j += 1)
        if (!used[j] && Math.abs(m[i][j]) > best) {
          best = Math.abs(m[i][j]);
          bi = i;
          bj = j;
        }
    if (bi < 0) break;
    [m[r], m[bi]] = [m[bi], m[r]];
    used[bj] = true;
    for (let i = r + 1; i < n; i += 1) {
      const f = m[i][bj] / m[r][bj];
      for (let j = 0; j < k; j += 1) m[i][j] -= f * m[r][j];
    }
    r += 1;
  }
  return r;
}

/**
 * e^A by scaling and squaring with the diagonal Padé approximant of degree 6 (Moler and Van Loan, "Nineteen
 * dubious ways", 2003). The scaling brings the norm under 1/2, where the approximant is exact to about 1e-16.
 */
export function expm(a: ReadonlyMat): Mat {
  const n = rows(a);
  if (cols(a) !== n) throw new MatError('shape');
  if (n === 0) return [];
  const nrm = norm1(a);
  if (!Number.isFinite(nrm)) throw new MatError('noConverge');
  const s = Math.max(0, Math.ceil(Math.log2(nrm / 0.5)) + 1);
  const as = scale(a, 2 ** -s);
  const q = 6;
  let c = 0.5;
  let x = copy(as);
  let num = add(eye(n), scale(as, c));
  let den = add(eye(n), scale(as, -c));
  let positive = true;
  for (let k = 2; k <= q; k += 1) {
    c = (c * (q - k + 1)) / (k * (2 * q - k + 1));
    x = mul(as, x);
    num = add(num, scale(x, c));
    den = add(den, scale(x, positive ? c : -c));
    positive = !positive;
  }
  let e = solve(den, num);
  for (let k = 0; k < s; k += 1) e = mul(e, e);
  return e;
}

/**
 * Exact zero-order-hold discretization over a step h: Φ = e^{Ah} and Γ = ∫₀ʰ e^{Aτ} dτ B, read from the
 * exponential of the block matrix [[A, B], [0, 0]]·h, which stays valid when A is singular.
 */
export function zohPair(a: ReadonlyMat, b: ReadonlyMat, h: number): { phi: Mat; gamma: Mat } {
  const n = rows(a);
  const m = cols(b);
  const big = zeros(n + m, n + m);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) big[i][j] = a[i][j] * h;
    for (let j = 0; j < m; j += 1) big[i][n + j] = b[i][j] * h;
  }
  const e = expm(big);
  return { phi: e.slice(0, n).map((row) => row.slice(0, n)), gamma: e.slice(0, n).map((row) => row.slice(n)) };
}

/**
 * The characteristic polynomial det(sI − A) and the adjugate coefficients by the Faddeev–Leverrier method:
 * det(sI − A) = sⁿ + c₁sⁿ⁻¹ + … + cₙ and adj(sI − A) = Σ M_k s^{n−1−k}. Coefficients come highest power first.
 */
export function leverrier(a: ReadonlyMat): { coeffs: number[]; adj: Mat[] } {
  const n = rows(a);
  if (cols(a) !== n) throw new MatError('shape');
  const coeffs = [1];
  const adj: Mat[] = [];
  let m = eye(n);
  for (let k = 1; k <= n; k += 1) {
    adj.push(m);
    const am = mul(a, m);
    let trace = 0;
    for (let i = 0; i < n; i += 1) trace += am[i][i];
    const ck = -trace / k;
    coeffs.push(ck);
    m = add(am, scale(eye(n), ck));
  }
  return { coeffs, adj };
}

/** The Kronecker product A ⊗ B. */
export function kron(a: ReadonlyMat, b: ReadonlyMat): Mat {
  const out = zeros(rows(a) * rows(b), cols(a) * cols(b));
  for (let i = 0; i < rows(a); i += 1)
    for (let j = 0; j < cols(a); j += 1)
      for (let k = 0; k < rows(b); k += 1)
        for (let l = 0; l < cols(b); l += 1) out[i * rows(b) + k][j * cols(b) + l] = a[i][j] * b[k][l];
  return out;
}

/**
 * Solves the continuous Lyapunov equation A X + X Aᵀ + Q = 0 by its Kronecker form
 * (I ⊗ A + A ⊗ I) vec X = −vec Q, for n ≤ 12. Throws 'singular' when A has eigenvalues λᵢ + λⱼ = 0.
 */
export function lyap(a: ReadonlyMat, q: ReadonlyMat): Mat {
  const n = rows(a);
  if (n > 12) throw new MatError('tooLarge');
  const big = add(kron(eye(n), a), kron(a, eye(n)));
  // vec stacks columns: vec(X)[j·n + i] = X[i][j].
  const rhs = zeros(n * n, 1);
  for (let j = 0; j < n; j += 1) for (let i = 0; i < n; i += 1) rhs[j * n + i][0] = -q[i][j];
  const v = solve(big, rhs);
  const x = zeros(n, n);
  for (let j = 0; j < n; j += 1) for (let i = 0; i < n; i += 1) x[i][j] = v[j * n + i][0];
  return x;
}

/** Least squares solution of A X ≈ B through the normal equations (A is tall with full column rank). */
export function lstsq(a: ReadonlyMat, b: ReadonlyMat): Mat {
  const at = transpose(a);
  return solve(mul(at, a), mul(at, b));
}

/** Rounds tiny entries to zero for display: |x| below tol·scale becomes 0. */
export const tidy = (x: number, scaleOf = 1, tol = 1e-12): number => (Math.abs(x) < tol * Math.max(1, scaleOf) ? 0 : x);

/** Checks a matrix for a shape: every row the same length and every entry finite. */
export function isWellFormed(a: ReadonlyMat): boolean {
  if (!a.length || !a[0].length) return false;
  const k = a[0].length;
  return a.every((row) => row.length === k && row.every(Number.isFinite));
}
