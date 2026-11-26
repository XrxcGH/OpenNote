// Eigenvalues and eigenvectors of a real upper Hessenberg matrix by the shifted double QR (Francis) iteration, after
// JAMA's hqr2 (public domain, NIST, and The MathWorks; from the Algol procedure hqr2 of Martin, Peters, and Wilkinson).
// Complex eigenvalues come in conjugate pairs: d[j] ± i e[j], with e[j] > 0 first. Their eigenvector is
// V[:, j] + i V[:, j + 1]. The long Algol procedure is split into its steps; the state they share is one record.
import { NumError } from '../errors';
import { cdiv, cx } from '../complex';
import type { Matrix } from './basic';

const EPS = 2 ** -52;

interface State {
  h: Matrix;
  v: Matrix;
  d: number[];
  e: number[];
  /** The last row not yet converged. */
  n: number;
  exshift: number;
  norm: number;
  p: number;
  q: number;
  r: number;
  s: number;
  w: number;
  x: number;
  y: number;
  z: number;
}

/** Runs the iteration on H (Hessenberg), accumulating into V (from orthes). Returns the eigenvalues' parts. */
export function hqr2(h: Matrix, v: Matrix): { d: number[]; e: number[] } {
  const nn = h.length;
  const st: State = {
    h,
    v,
    d: new Array<number>(nn).fill(0),
    e: new Array<number>(nn).fill(0),
    n: nn - 1,
    exshift: 0,
    norm: 0,
    ...{ p: 0, q: 0, r: 0, s: 0, w: 0, x: 0, y: 0, z: 0 },
  };
  for (let i = 0; i < nn; i += 1) for (let j = Math.max(i - 1, 0); j < nn; j += 1) st.norm += Math.abs(h[i][j]);
  let iter = 0;
  while (st.n >= 0) {
    const l = smallSubdiagonal(st);
    if (l === st.n) {
      oneRoot(st);
      iter = 0;
    } else if (l === st.n - 1) {
      twoRoots(st);
      iter = 0;
    } else {
      shift(st, l, iter);
      iter += 1;
      if (iter > 120) throw new NumError('noConvergence', 'eigenvalues');
      const m = startRow(st, l);
      for (let i = m + 2; i <= st.n; i += 1) {
        h[i][i - 2] = 0;
        if (i > m + 2) h[i][i - 3] = 0;
      }
      doubleQrStep(st, l, m);
    }
  }
  if (st.norm !== 0) {
    backSubstitute(st);
    backTransform(st);
  }
  return { d: st.d, e: st.e };
}

/** The lowest l above which the subdiagonal is negligible. */
function smallSubdiagonal(st: State): number {
  const { h } = st;
  let l = st.n;
  while (l > 0) {
    let s = Math.abs(h[l - 1][l - 1]) + Math.abs(h[l][l]);
    if (s === 0) s = st.norm;
    if (Math.abs(h[l][l - 1]) < EPS * s) break;
    l -= 1;
  }
  return l;
}

function oneRoot(st: State): void {
  const { h, n } = st;
  h[n][n] += st.exshift;
  st.d[n] = h[n][n];
  st.e[n] = 0;
  st.n -= 1;
}

/** A 2 by 2 block has converged: a real pair (made triangular) or a complex pair. */
function twoRoots(st: State): void {
  const { h, v, n } = st;
  const w = h[n][n - 1] * h[n - 1][n];
  let p = (h[n - 1][n - 1] - h[n][n]) / 2;
  let q = p * p + w;
  let z = Math.sqrt(Math.abs(q));
  h[n][n] += st.exshift;
  h[n - 1][n - 1] += st.exshift;
  const x = h[n][n];
  if (q >= 0) {
    z = p >= 0 ? p + z : p - z;
    st.d[n - 1] = x + z;
    st.d[n] = z !== 0 ? x - w / z : st.d[n - 1];
    st.e[n - 1] = 0;
    st.e[n] = 0;
    const sub = h[n][n - 1];
    const s = Math.abs(sub) + Math.abs(z);
    p = sub / s;
    q = z / s;
    const r = Math.sqrt(p * p + q * q);
    p /= r;
    q /= r;
    rotateRows(h, n, p, q);
    rotateColumns(h, n, p, q, n);
    rotateColumns(v, n, p, q, v.length - 1);
  } else {
    st.d[n - 1] = x + p;
    st.d[n] = x + p;
    st.e[n - 1] = z;
    st.e[n] = -z;
  }
  st.n -= 2;
}

/** The plane rotation of twoRoots on rows n-1 and n. */
function rotateRows(a: Matrix, n: number, p: number, q: number): void {
  for (let j = n - 1; j < a.length; j += 1) {
    const z = a[n - 1][j];
    a[n - 1][j] = q * z + p * a[n][j];
    a[n][j] = q * a[n][j] - p * z;
  }
}

/** The same rotation on columns n-1 and n, rows 0..last. */
function rotateColumns(a: Matrix, n: number, p: number, q: number, last: number): void {
  for (let i = 0; i <= last; i += 1) {
    const z = a[i][n - 1];
    a[i][n - 1] = q * z + p * a[i][n];
    a[i][n] = q * a[i][n] - p * z;
  }
}

/** The shift for the next step, with Wilkinson's exceptional shift at step 10 and MATLAB's at step 30. */
function shift(st: State, l: number, iter: number): void {
  const { h, n } = st;
  st.x = h[n][n];
  st.y = 0;
  st.w = 0;
  if (l < n) {
    st.y = h[n - 1][n - 1];
    st.w = h[n][n - 1] * h[n - 1][n];
  }
  if (iter === 10) {
    st.exshift += st.x;
    for (let i = 0; i <= n; i += 1) h[i][i] -= st.x;
    const s = Math.abs(h[n][n - 1]) + Math.abs(h[n - 1][n - 2]);
    st.x = 0.75 * s;
    st.y = st.x;
    st.w = -0.4375 * s * s;
  }
  if (iter === 30) {
    let s = (st.y - st.x) / 2;
    s = s * s + st.w;
    if (s > 0) {
      s = Math.sqrt(s);
      if (st.y < st.x) s = -s;
      s = st.x - st.w / ((st.y - st.x) / 2 + s);
      for (let i = 0; i <= n; i += 1) h[i][i] -= s;
      st.exshift += s;
      st.x = 0.964;
      st.y = 0.964;
      st.w = 0.964;
    }
  }
}

/** Looks for two consecutive small subdiagonal elements; the double step starts at the row it returns. */
function startRow(st: State, l: number): number {
  const { h } = st;
  let m = st.n - 2;
  while (m >= l) {
    st.z = h[m][m];
    st.r = st.x - st.z;
    st.s = st.y - st.z;
    st.p = (st.r * st.s - st.w) / h[m + 1][m] + h[m][m + 1];
    st.q = h[m + 1][m + 1] - st.z - st.r - st.s;
    st.r = h[m + 2][m + 1];
    st.s = Math.abs(st.p) + Math.abs(st.q) + Math.abs(st.r);
    st.p /= st.s;
    st.q /= st.s;
    st.r /= st.s;
    if (m === l) break;
    const left = Math.abs(h[m][m - 1]) * (Math.abs(st.q) + Math.abs(st.r));
    const right = EPS * (Math.abs(st.p) * (Math.abs(h[m - 1][m - 1]) + Math.abs(st.z) + Math.abs(h[m + 1][m + 1])));
    if (left < right) break;
    m -= 1;
  }
  return m;
}

/** One Francis double QR step on rows l..n and columns m..n. */
function doubleQrStep(st: State, l: number, m: number): void {
  const { h, n } = st;
  for (let k = m; k <= n - 1; k += 1) {
    const notlast = k !== n - 1;
    if (k !== m) {
      st.p = h[k][k - 1];
      st.q = h[k + 1][k - 1];
      st.r = notlast ? h[k + 2][k - 1] : 0;
      st.x = Math.abs(st.p) + Math.abs(st.q) + Math.abs(st.r);
      if (st.x === 0) continue;
      st.p /= st.x;
      st.q /= st.x;
      st.r /= st.x;
    }
    let s = Math.sqrt(st.p * st.p + st.q * st.q + st.r * st.r);
    if (st.p < 0) s = -s;
    if (s === 0) continue;
    if (k !== m) h[k][k - 1] = -s * st.x;
    else if (l !== m) h[k][k - 1] = -h[k][k - 1];
    st.p += s;
    st.x = st.p / s;
    st.y = st.q / s;
    st.z = st.r / s;
    st.q /= st.p;
    st.r /= st.p;
    reflect(st, k, notlast);
  }
}

/** Applies the step's 3-element reflection to the rows and columns of H and the columns of V. */
function reflect(st: State, k: number, notlast: boolean): void {
  const { h, v, n, x, y, z, q, r } = st;
  for (let j = k; j < h.length; j += 1) {
    let p = h[k][j] + q * h[k + 1][j];
    if (notlast) {
      p += r * h[k + 2][j];
      h[k + 2][j] -= p * z;
    }
    h[k][j] -= p * x;
    h[k + 1][j] -= p * y;
  }
  const columns = (a: Matrix, last: number) => {
    for (let i = 0; i <= last; i += 1) {
      let p = x * a[i][k] + y * a[i][k + 1];
      if (notlast) {
        p += z * a[i][k + 2];
        a[i][k + 2] -= p * r;
      }
      a[i][k] -= p;
      a[i][k + 1] -= p * q;
    }
  };
  columns(h, Math.min(n, k + 3));
  columns(v, v.length - 1);
}

/** Solves for the eigenvectors of the quasi-triangular matrix left in H, last column first. */
function backSubstitute(st: State): void {
  for (let n = st.h.length - 1; n >= 0; n -= 1) {
    if (st.e[n] === 0) realVector(st, n);
    else if (st.e[n] < 0) complexVector(st, n);
  }
}

function realVector(st: State, n: number): void {
  const { h, d, e } = st;
  const p = d[n];
  let l = n;
  h[n][n] = 1;
  for (let i = n - 1; i >= 0; i -= 1) {
    const w = h[i][i] - p;
    let r = 0;
    for (let j = l; j <= n; j += 1) r += h[i][j] * h[j][n];
    if (e[i] < 0) {
      st.z = w;
      st.s = r;
      continue;
    }
    l = i;
    if (e[i] === 0) {
      h[i][n] = w !== 0 ? -r / w : -r / (EPS * st.norm);
    } else {
      const x = h[i][i + 1];
      const y = h[i + 1][i];
      const q = (d[i] - p) * (d[i] - p) + e[i] * e[i];
      const t = (x * st.s - st.z * r) / q;
      h[i][n] = t;
      h[i + 1][n] = Math.abs(x) > Math.abs(st.z) ? (-r - w * t) / x : (-st.s - y * t) / st.z;
    }
    const t = Math.abs(h[i][n]);
    if (EPS * t * t > 1) for (let j = i; j <= n; j += 1) h[j][n] /= t;
  }
}

function complexVector(st: State, n: number): void {
  const { h, d, e } = st;
  const p = d[n];
  const q = e[n];
  let l = n - 1;
  if (Math.abs(h[n][n - 1]) > Math.abs(h[n - 1][n])) {
    h[n - 1][n - 1] = q / h[n][n - 1];
    h[n - 1][n] = -(h[n][n] - p) / h[n][n - 1];
  } else {
    const c = cdiv(cx(0, -h[n - 1][n]), cx(h[n - 1][n - 1] - p, q));
    h[n - 1][n - 1] = c.re;
    h[n - 1][n] = c.im;
  }
  h[n][n - 1] = 0;
  h[n][n] = 1;
  for (let i = n - 2; i >= 0; i -= 1) {
    let ra = 0;
    let sa = 0;
    for (let j = l; j <= n; j += 1) {
      ra += h[i][j] * h[j][n - 1];
      sa += h[i][j] * h[j][n];
    }
    const w = h[i][i] - p;
    if (e[i] < 0) {
      st.z = w;
      st.r = ra;
      st.s = sa;
      continue;
    }
    l = i;
    if (e[i] === 0) {
      const c = cdiv(cx(-ra, -sa), cx(w, q));
      h[i][n - 1] = c.re;
      h[i][n] = c.im;
    } else {
      complexPair(st, i, n, w, ra, sa);
    }
    const t = Math.max(Math.abs(h[i][n - 1]), Math.abs(h[i][n]));
    if (EPS * t * t > 1)
      for (let j = i; j <= n; j += 1) {
        h[j][n - 1] /= t;
        h[j][n] /= t;
      }
  }
}

/** Solves the 2 by 2 complex system of rows i and i+1 for a complex eigenvector. */
function complexPair(st: State, i: number, n: number, w: number, ra: number, sa: number): void {
  const { h, d, e } = st;
  const p = d[n];
  const q = e[n];
  const x = h[i][i + 1];
  const y = h[i + 1][i];
  let vr = (d[i] - p) * (d[i] - p) + e[i] * e[i] - q * q;
  const vi = (d[i] - p) * 2 * q;
  if (vr === 0 && vi === 0) {
    vr = EPS * st.norm * (Math.abs(w) + Math.abs(q) + Math.abs(x) + Math.abs(y) + Math.abs(st.z));
  }
  const c = cdiv(cx(x * st.r - st.z * ra + q * sa, x * st.s - st.z * sa - q * ra), cx(vr, vi));
  h[i][n - 1] = c.re;
  h[i][n] = c.im;
  if (Math.abs(x) > Math.abs(st.z) + Math.abs(q)) {
    h[i + 1][n - 1] = (-ra - w * h[i][n - 1] + q * h[i][n]) / x;
    h[i + 1][n] = (-sa - w * h[i][n] - q * h[i][n - 1]) / x;
  } else {
    const c2 = cdiv(cx(-st.r - y * h[i][n - 1], -st.s - y * h[i][n]), cx(st.z, q));
    h[i + 1][n - 1] = c2.re;
    h[i + 1][n] = c2.im;
  }
}

/** Multiplies the vectors back by V, giving the eigenvectors of the original matrix. */
function backTransform(st: State): void {
  const { h, v } = st;
  const nn = h.length;
  for (let j = nn - 1; j >= 0; j -= 1) {
    for (let i = 0; i < nn; i += 1) {
      let z = 0;
      for (let k = 0; k <= j; k += 1) z += v[i][k] * h[k][j];
      v[i][j] = z;
    }
  }
}
