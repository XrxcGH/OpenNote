// Singular value decomposition, after JAMA (public domain, NIST, and The MathWorks; from LINPACK's dsvdc): A = U S Vᵀ
// for an m by n A with m >= n, by Householder bidiagonalization and the implicit-shift QR iteration on the
// bidiagonal. A wide matrix is handled through its transpose. Singular values come out largest first.
import { NumError } from '../errors';
import { clone, cols, hypot, rows, transpose, zeros } from './basic';
import type { Matrix, MatrixLike } from './basic';

const EPS = 2 ** -52;
const TINY = 2 ** -966;

export interface Svd {
  /** m by min(m, n), orthonormal columns. */
  u: Matrix;
  /** The singular values, largest first. */
  s: number[];
  /** n by min(m, n), orthonormal columns. */
  v: Matrix;
}

export function svd(a: MatrixLike): Svd {
  if (rows(a) < cols(a)) {
    const flipped = svdTall(transpose(a));
    return { u: flipped.v, s: flipped.s, v: flipped.u };
  }
  return svdTall(a);
}

interface Work {
  a: Matrix;
  m: number;
  n: number;
  s: number[];
  e: number[];
  u: Matrix;
  v: Matrix;
}

function svdTall(input: MatrixLike): Svd {
  const m = rows(input);
  const n = cols(input);
  const w: Work = {
    a: clone(input),
    m,
    n,
    s: new Array<number>(n).fill(0),
    e: new Array<number>(n).fill(0),
    u: zeros(m, n),
    v: zeros(n, n),
  };
  const nct = Math.min(m - 1, n);
  const nrt = Math.max(0, Math.min(n - 2, m));
  for (let k = 0; k < Math.max(nct, nrt); k += 1) bidiagonalStep(w, k, nct, nrt);
  const p = Math.min(n, m + 1);
  if (nct < n) w.s[nct] = w.a[nct][nct];
  if (m < p) w.s[p - 1] = 0;
  if (nrt + 1 < p) w.e[nrt] = w.a[nrt][p - 1];
  w.e[p - 1] = 0;
  generateU(w, nct);
  generateV(w, nrt);
  iterate(w, p);
  return { u: w.u, s: w.s.slice(0, n), v: w.v };
}

/** Householder step k: zeros column k below the diagonal and row k right of the superdiagonal. */
function bidiagonalStep(w: Work, k: number, nct: number, nrt: number): void {
  const { a, m, n, s, e } = w;
  if (k < nct) {
    s[k] = 0;
    for (let i = k; i < m; i += 1) s[k] = hypot(s[k], a[i][k]);
    if (s[k] !== 0) {
      if (a[k][k] < 0) s[k] = -s[k];
      for (let i = k; i < m; i += 1) a[i][k] /= s[k];
      a[k][k] += 1;
    }
    s[k] = -s[k];
  }
  for (let j = k + 1; j < n; j += 1) {
    if (k < nct && s[k] !== 0) {
      let t = 0;
      for (let i = k; i < m; i += 1) t += a[i][k] * a[i][j];
      t = -t / a[k][k];
      for (let i = k; i < m; i += 1) a[i][j] += t * a[i][k];
    }
    e[j] = a[k][j];
  }
  if (k < nct) for (let i = k; i < m; i += 1) w.u[i][k] = a[i][k];
  if (k < nrt) rowStep(w, k);
}

function rowStep(w: Work, k: number): void {
  const { a, m, n, e } = w;
  e[k] = 0;
  for (let i = k + 1; i < n; i += 1) e[k] = hypot(e[k], e[i]);
  if (e[k] !== 0) {
    if (e[k + 1] < 0) e[k] = -e[k];
    for (let i = k + 1; i < n; i += 1) e[i] /= e[k];
    e[k + 1] += 1;
  }
  e[k] = -e[k];
  if (k + 1 < m && e[k] !== 0) {
    const work = new Array<number>(m).fill(0);
    for (let j = k + 1; j < n; j += 1) for (let i = k + 1; i < m; i += 1) work[i] += e[j] * a[i][j];
    for (let j = k + 1; j < n; j += 1) {
      const t = -e[j] / e[k + 1];
      for (let i = k + 1; i < m; i += 1) a[i][j] += t * work[i];
    }
  }
  for (let i = k + 1; i < n; i += 1) w.v[i][k] = e[i];
}

function generateU(w: Work, nct: number): void {
  const { u, m, n, s } = w;
  for (let j = nct; j < n; j += 1) {
    for (let i = 0; i < m; i += 1) u[i][j] = 0;
    u[j][j] = 1;
  }
  for (let k = nct - 1; k >= 0; k -= 1) {
    if (s[k] === 0) {
      for (let i = 0; i < m; i += 1) u[i][k] = 0;
      u[k][k] = 1;
      continue;
    }
    for (let j = k + 1; j < n; j += 1) {
      let t = 0;
      for (let i = k; i < m; i += 1) t += u[i][k] * u[i][j];
      t = -t / u[k][k];
      for (let i = k; i < m; i += 1) u[i][j] += t * u[i][k];
    }
    for (let i = k; i < m; i += 1) u[i][k] = -u[i][k];
    u[k][k] += 1;
    for (let i = 0; i < k - 1; i += 1) u[i][k] = 0;
  }
}

function generateV(w: Work, nrt: number): void {
  const { v, n, e } = w;
  for (let k = n - 1; k >= 0; k -= 1) {
    if (k < nrt && e[k] !== 0) {
      for (let j = k + 1; j < n; j += 1) {
        let t = 0;
        for (let i = k + 1; i < n; i += 1) t += v[i][k] * v[i][j];
        t = -t / v[k + 1][k];
        for (let i = k + 1; i < n; i += 1) v[i][j] += t * v[i][k];
      }
    }
    for (let i = 0; i < n; i += 1) v[i][k] = 0;
    v[k][k] = 1;
  }
}

/** The QR iteration on the bidiagonal of order p, until every superdiagonal element is negligible. */
function iterate(w: Work, start: number): void {
  const { s, e } = w;
  let p = start;
  const pp = p - 1;
  let steps = 0;
  while (p > 0) {
    if ((steps += 1) > 75 * start) throw new NumError('noConvergence', 'singular values');
    let k: number;
    for (k = p - 2; k >= 0; k -= 1) {
      if (Math.abs(e[k]) <= TINY + EPS * (Math.abs(s[k]) + Math.abs(s[k + 1]))) {
        e[k] = 0;
        break;
      }
    }
    let kase: number;
    if (k === p - 2) {
      kase = 4;
    } else {
      let ks: number;
      for (ks = p - 1; ks > k; ks -= 1) {
        const t = (ks !== p ? Math.abs(e[ks]) : 0) + (ks !== k + 1 ? Math.abs(e[ks - 1]) : 0);
        if (Math.abs(s[ks]) <= TINY + EPS * t) {
          s[ks] = 0;
          break;
        }
      }
      if (ks === k) kase = 3;
      else if (ks === p - 1) kase = 1;
      else {
        kase = 2;
        k = ks;
      }
    }
    k += 1;
    if (kase === 1) deflate(w, k, p);
    else if (kase === 2) split(w, k, p);
    else if (kase === 3) qrStep(w, k, p);
    else {
      converge(w, k, pp);
      p -= 1;
    }
  }
}

/** Deflates a negligible s[p-1]. */
function deflate(w: Work, k: number, p: number): void {
  const { s, e, v, n } = w;
  let f = e[p - 2];
  e[p - 2] = 0;
  for (let j = p - 2; j >= k; j -= 1) {
    let t = hypot(s[j], f);
    const cs = s[j] / t;
    const sn = f / t;
    s[j] = t;
    if (j !== k) {
      f = -sn * e[j - 1];
      e[j - 1] = cs * e[j - 1];
    }
    for (let i = 0; i < n; i += 1) {
      t = cs * v[i][j] + sn * v[i][p - 1];
      v[i][p - 1] = -sn * v[i][j] + cs * v[i][p - 1];
      v[i][j] = t;
    }
  }
}

/** Splits at a negligible s[k-1]. */
function split(w: Work, k: number, p: number): void {
  const { s, e, u, m } = w;
  let f = e[k - 1];
  e[k - 1] = 0;
  for (let j = k; j < p; j += 1) {
    let t = hypot(s[j], f);
    const cs = s[j] / t;
    const sn = f / t;
    s[j] = t;
    f = -sn * e[j];
    e[j] = cs * e[j];
    for (let i = 0; i < m; i += 1) {
      t = cs * u[i][j] + sn * u[i][k - 1];
      u[i][k - 1] = -sn * u[i][j] + cs * u[i][k - 1];
      u[i][j] = t;
    }
  }
}

/** Rotates columns j and j+1 of a: c·aj + s·aj1 into j, -s·aj + c·aj1 into j+1. */
function turn(a: Matrix, j: number, cs: number, sn: number): void {
  for (const row of a) {
    const t = cs * row[j] + sn * row[j + 1];
    row[j + 1] = -sn * row[j] + cs * row[j + 1];
    row[j] = t;
  }
}

/** One implicit-shift QR step on rows k..p-1. */
function qrStep(w: Work, k: number, p: number): void {
  const { s, e, u, v, m } = w;
  const scale = Math.max(Math.abs(s[p - 1]), Math.abs(s[p - 2]), Math.abs(e[p - 2]), Math.abs(s[k]), Math.abs(e[k]));
  const sp = s[p - 1] / scale;
  const spm1 = s[p - 2] / scale;
  const epm1 = e[p - 2] / scale;
  const sk = s[k] / scale;
  const ek = e[k] / scale;
  const b = ((spm1 + sp) * (spm1 - sp) + epm1 * epm1) / 2;
  const c = sp * epm1 * (sp * epm1);
  let shiftValue = 0;
  if (b !== 0 || c !== 0) {
    shiftValue = Math.sqrt(b * b + c);
    if (b < 0) shiftValue = -shiftValue;
    shiftValue = c / (b + shiftValue);
  }
  let f = (sk + sp) * (sk - sp) + shiftValue;
  let g = sk * ek;
  for (let j = k; j < p - 1; j += 1) {
    let t = hypot(f, g);
    let cs = f / t;
    let sn = g / t;
    if (j !== k) e[j - 1] = t;
    f = cs * s[j] + sn * e[j];
    e[j] = cs * e[j] - sn * s[j];
    g = sn * s[j + 1];
    s[j + 1] = cs * s[j + 1];
    turn(v, j, cs, sn);
    t = hypot(f, g);
    cs = f / t;
    sn = g / t;
    s[j] = t;
    f = cs * e[j] + sn * s[j + 1];
    s[j + 1] = -sn * e[j] + cs * s[j + 1];
    g = sn * e[j + 1];
    e[j + 1] = cs * e[j + 1];
    if (j < m - 1) turn(u, j, cs, sn);
  }
  e[p - 2] = f;
}

/** A singular value has converged: makes it positive and moves it into order. */
function converge(w: Work, start: number, pp: number): void {
  const { s, u, v, m, n } = w;
  let k = start;
  if (s[k] <= 0) {
    s[k] = s[k] < 0 ? -s[k] : 0;
    for (let i = 0; i <= pp; i += 1) v[i][k] = -v[i][k];
  }
  while (k < pp && s[k] < s[k + 1]) {
    [s[k], s[k + 1]] = [s[k + 1], s[k]];
    if (k < n - 1) for (const row of v) [row[k], row[k + 1]] = [row[k + 1], row[k]];
    if (k < m - 1) for (const row of u) [row[k], row[k + 1]] = [row[k + 1], row[k]];
    k += 1;
  }
}
