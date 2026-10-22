// Small dense linear algebra for the solvers: Gaussian elimination with partial pivoting, least squares by the
// normal equations, and the reduced row echelon form for null spaces. Matrices here are a few rows at most.

export type Matrix = number[][];

/** x with A x = b, or null when A is singular to working precision. */
export function solveLinear(A: readonly (readonly number[])[], b: readonly number[]): number[] | null {
  const n = A.length;
  const m = A.map((row, i) => [...row, b[i]]);
  const scale = Math.max(1e-300, ...A.flat().map(Math.abs));
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    if (Math.abs(m[pivot][col]) <= 1e-13 * scale) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = m[row][col] / m[col][col];
      for (let k = col; k <= n; k += 1) m[row][k] -= factor * m[col][k];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

/** The least-squares x for A x ≈ b, from the normal equations. */
export function leastSquares(A: readonly (readonly number[])[], b: readonly number[]): number[] | null {
  const cols = A[0]?.length ?? 0;
  const ata = Array.from({ length: cols }, (_, i) =>
    Array.from({ length: cols }, (__, j) => A.reduce((sum, row) => sum + row[i] * row[j], 0)),
  );
  const atb = Array.from({ length: cols }, (_, i) => A.reduce((sum, row, r) => sum + row[i] * b[r], 0));
  return solveLinear(ata, atb);
}

/** The reduced row echelon form, with entries below `tolerance` set to zero, and the pivot columns. */
export function rref(input: readonly (readonly number[])[], tolerance = 1e-9): { m: Matrix; pivots: number[] } {
  const m = input.map((row) => [...row]);
  const rows = m.length;
  const cols = m[0]?.length ?? 0;
  const pivots: number[] = [];
  let r = 0;
  for (let c = 0; c < cols && r < rows; c += 1) {
    let best = r;
    for (let i = r + 1; i < rows; i += 1) if (Math.abs(m[i][c]) > Math.abs(m[best][c])) best = i;
    if (Math.abs(m[best][c]) <= tolerance) continue;
    [m[r], m[best]] = [m[best], m[r]];
    const lead = m[r][c];
    for (let k = 0; k < cols; k += 1) m[r][k] /= lead;
    for (let i = 0; i < rows; i += 1) {
      if (i === r) continue;
      const factor = m[i][c];
      for (let k = 0; k < cols; k += 1) m[i][k] -= factor * m[r][k];
    }
    pivots.push(c);
    r += 1;
  }
  for (const row of m) for (let k = 0; k < cols; k += 1) if (Math.abs(row[k]) <= tolerance) row[k] = 0;
  return { m, pivots };
}

/** A basis of the null space of a matrix, each vector scaled so its largest entry is 1. */
export function nullSpace(input: readonly (readonly number[])[], tolerance = 1e-9): number[][] {
  const cols = input[0]?.length ?? 0;
  const { m, pivots } = rref(input, tolerance);
  const free = Array.from({ length: cols }, (_, i) => i).filter((c) => !pivots.includes(c));
  return free.map((f) => {
    const v = Array.from({ length: cols }, () => 0);
    v[f] = 1;
    pivots.forEach((p, row) => {
      v[p] = -m[row][f];
    });
    const big = v.reduce((best, x) => (Math.abs(x) > Math.abs(best) ? x : best), 0);
    return v.map((x) => x / big);
  });
}

/** The determinant, by elimination. */
export function determinant(input: readonly (readonly number[])[]): number {
  const m = input.map((row) => [...row]);
  const n = m.length;
  let det = 1;
  for (let c = 0; c < n; c += 1) {
    let p = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (m[p][c] === 0) return 0;
    if (p !== c) {
      [m[p], m[c]] = [m[c], m[p]];
      det = -det;
    }
    det *= m[c][c];
    for (let r = c + 1; r < n; r += 1) {
      const factor = m[r][c] / m[c][c];
      for (let k = c; k < n; k += 1) m[r][k] -= factor * m[c][k];
    }
  }
  return det;
}
