// Square linear systems in exact fractions by Gauss-Jordan elimination with partial pivoting on nonzero entries.
import { div, isZero, mul, sub } from './frac';
import type { Frac } from './frac';

/** The solution of A x = b, or null when A is singular. */
export function solveExact(a: readonly (readonly Frac[])[], b: readonly Frac[]): Frac[] | null {
  const n = a.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col += 1) {
    const p = m.findIndex((row, r) => r >= col && !isZero(row[col]));
    if (p < 0) return null;
    [m[col], m[p]] = [m[p], m[col]];
    const pivot = m[col][col];
    m[col] = m[col].map((v) => div(v, pivot));
    for (let r = 0; r < n; r += 1)
      if (r !== col && !isZero(m[r][col])) {
        const f = m[r][col];
        m[r] = m[r].map((v, j) => sub(v, mul(f, m[col][j])));
      }
  }
  return m.map((row) => row[n]);
}
