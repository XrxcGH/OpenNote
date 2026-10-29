// Reduction of a general real matrix to upper Hessenberg form by orthogonal similarity transforms, after JAMA's
// orthes (public domain, NIST, and The MathWorks; from the Algol procedures orthes and ortran of Martin and
// Wilkinson). H = Vᵀ A V with V orthogonal; the eigenvalue iteration (hqr2.ts) then works on H.
import { identity } from './basic';
import type { Matrix } from './basic';

/** Reduces H in place to Hessenberg form and returns the accumulated transform V. */
export function orthes(h: Matrix): Matrix {
  const n = h.length;
  const high = n - 1;
  const ort = new Array<number>(n).fill(0);
  for (let m = 1; m <= high - 1; m += 1) {
    let scale = 0;
    for (let i = m; i <= high; i += 1) scale += Math.abs(h[i][m - 1]);
    if (scale !== 0) reflect(h, ort, m, scale);
  }
  const v = identity(n);
  for (let m = high - 1; m >= 1; m -= 1) {
    if (h[m][m - 1] === 0) continue;
    for (let i = m + 1; i <= high; i += 1) ort[i] = h[i][m - 1];
    for (let j = m; j <= high; j += 1) {
      let g = 0;
      for (let i = m; i <= high; i += 1) g += ort[i] * v[i][j];
      // Two divisions, so a tiny value cannot underflow.
      g = g / ort[m] / h[m][m - 1];
      for (let i = m; i <= high; i += 1) v[i][j] += g * ort[i];
    }
  }
  return v;
}

/** Applies the Householder reflection that zeros column m-1 below the subdiagonal. */
function reflect(h: Matrix, ort: number[], m: number, scale: number): void {
  const n = h.length;
  const high = n - 1;
  let sum = 0;
  for (let i = high; i >= m; i -= 1) {
    ort[i] = h[i][m - 1] / scale;
    sum += ort[i] * ort[i];
  }
  let g = Math.sqrt(sum);
  if (ort[m] > 0) g = -g;
  sum -= ort[m] * g;
  ort[m] -= g;
  for (let j = m; j < n; j += 1) {
    let f = 0;
    for (let i = high; i >= m; i -= 1) f += ort[i] * h[i][j];
    f /= sum;
    for (let i = m; i <= high; i += 1) h[i][j] -= f * ort[i];
  }
  for (let i = 0; i <= high; i += 1) {
    let f = 0;
    for (let j = high; j >= m; j -= 1) f += ort[j] * h[i][j];
    f /= sum;
    for (let j = m; j <= high; j += 1) h[i][j] -= f * ort[j];
  }
  ort[m] *= scale;
  h[m][m - 1] = scale * g;
}
