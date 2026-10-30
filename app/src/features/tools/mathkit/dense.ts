// Dense floating-point linear algebra for small systems: solving, determinants, Newton's method for systems, and
// the matrix exponential. Sizes stay small (a few dozen), so these are written for clarity, not speed.

export type Mat = number[][];

/** Solves A x = b by Gaussian elimination with partial pivoting. Null when A is singular. */
export function solveDense(A: readonly (readonly number[])[], b: readonly number[]): number[] | null {
  const n = A.length;
  const m = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-300) return null;
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

export const matMul = (a: Mat, b: Mat): Mat =>
  a.map((row) => b[0].map((_, j) => row.reduce((s, v, k) => s + v * b[k][j], 0)));

export const identity = (n: number): Mat =>
  Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));

/** exp(M) by scaling and squaring with a Taylor series. */
export function expm(M: Mat): Mat {
  const n = M.length;
  const norm = Math.max(...M.map((row) => row.reduce((s, v) => s + Math.abs(v), 0)));
  const squarings = Math.max(0, Math.ceil(Math.log2(Math.max(norm, 1e-300))) + 2);
  const scaled = M.map((row) => row.map((v) => v / 2 ** squarings));
  let term = identity(n);
  let sum = identity(n);
  for (let k = 1; k < 30; k++) {
    term = matMul(term, scaled).map((row) => row.map((v) => v / k));
    sum = sum.map((row, i) => row.map((v, j) => v + term[i][j]));
  }
  for (let s = 0; s < squarings; s++) sum = matMul(sum, sum);
  return sum;
}

/** The Jacobian of F at x by central differences. */
export function numericJacobian(F: (x: readonly number[]) => number[], x: readonly number[]): Mat {
  const n = x.length;
  const J: Mat = Array.from({ length: F(x).length }, () => new Array<number>(n).fill(0));
  for (let j = 0; j < n; j++) {
    const h = 1e-6 * Math.max(1, Math.abs(x[j]));
    const up = x.slice();
    const down = x.slice();
    up[j] += h;
    down[j] -= h;
    const a = F(up);
    const b = F(down);
    for (let i = 0; i < J.length; i++) J[i][j] = (a[i] - b[i]) / (2 * h);
  }
  return J;
}

export interface NewtonStep {
  iteration: number;
  x: number[];
  residual: number;
}

export interface NewtonResult {
  x: number[];
  converged: boolean;
  history: NewtonStep[];
}

/** Newton's method for F(x) = 0. The Jacobian is exact when given and by differences otherwise. */
export function newtonSystem(
  F: (x: readonly number[]) => number[],
  x0: readonly number[],
  options: { jacobian?: (x: readonly number[]) => Mat; tolerance?: number; maxIterations?: number } = {},
): NewtonResult {
  const tolerance = options.tolerance ?? 1e-12;
  let x = x0.slice();
  const history: NewtonStep[] = [];
  const norm = (v: readonly number[]) => Math.sqrt(v.reduce((s, a) => s + a * a, 0));
  for (let iteration = 0; iteration <= (options.maxIterations ?? 60); iteration++) {
    const f = F(x);
    const residual = norm(f);
    history.push({ iteration, x: x.slice(), residual });
    if (!Number.isFinite(residual)) return { x, converged: false, history };
    if (residual < tolerance) return { x, converged: true, history };
    const J = options.jacobian ? options.jacobian(x) : numericJacobian(F, x);
    const dx = solveDense(
      J,
      f.map((v) => -v),
    );
    if (!dx) return { x, converged: false, history };
    x = x.map((v, i) => v + dx[i]);
    if (norm(dx) < tolerance * (1 + norm(x)) && residual < 1e-6) {
      history.push({ iteration: iteration + 1, x: x.slice(), residual: norm(F(x)) });
      return { x, converged: true, history };
    }
  }
  return { x, converged: false, history };
}
