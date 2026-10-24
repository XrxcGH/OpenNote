// Small dense linear algebra for the engineering solvers: Gaussian elimination with partial pivoting. The systems
// are tens of unknowns at most (a truss of a few dozen joints, a circuit of a few dozen nodes), so a dense solve is
// fast and simple. A singular system returns null, which the solvers turn into words such as "the truss can move".

/**
 * Solves A x = b. Returns null when A is singular (to a tolerance relative to its largest entry). The answer is not
 * rounded: callers round what they show with `clean`.
 */
export function solveLinear(matrix: readonly (readonly number[])[], rhs: readonly number[]): number[] | null {
  const first = eliminate(matrix, rhs);
  if (!first) return null;
  // One step of iterative refinement takes the error from about 1e-11 to the last digit, which matters for stiffness
  // matrices that mix lengths and lengths cubed.
  const residual = rhs.map((b, i) => b - matrix[i].reduce((sum, a, j) => sum + a * first[j], 0));
  const fix = eliminate(matrix, residual);
  return first.map((x, i) => x + (fix?.[i] ?? 0));
}

function eliminate(matrix: readonly (readonly number[])[], rhs: readonly number[]): number[] | null {
  const n = rhs.length;
  if (n === 0) return [];
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  let scale = 0;
  for (const row of a) for (let j = 0; j < n; j++) scale = Math.max(scale, Math.abs(row[j]));
  if (scale === 0) return null;
  const tolerance = scale * 1e-11;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) < tolerance) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = a[r][col] / a[col][col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) a[r][c] -= factor * a[col][c];
    }
  }
  return a.map((row, i) => row[n] / row[i]);
}

/** Rounds away floating-point dust to twelve significant digits: 1e-15 becomes 0, and 4.9999999999999 becomes 5. */
export function clean(value: number): number {
  if (!Number.isFinite(value)) return value;
  if (Math.abs(value) < 1e-10) return 0;
  return Number(value.toPrecision(12));
}

/** A zero matrix of n rows and m columns. */
export const zeros = (n: number, m: number): number[][] =>
  Array.from({ length: n }, () => new Array<number>(m).fill(0));
