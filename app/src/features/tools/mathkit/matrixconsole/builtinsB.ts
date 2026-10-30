// Built-in functions, part two: linear algebra (det, inv, eig, svd, lu, qr, chol, norm, null, expm), polynomials,
// interpolation and quadrature, and the functions that take a function handle (fzero, integral, feval, arrayfun).
import { expm, identity, type Mat } from '../dense';
import { eigenvalues, realEigenvector, sortEigenvalues, svd, symmetricEigen } from '../eigen';
import { determinant, luFactor, normOf, pinv, pivotRatio, rankF, transposeF } from '../fmat';
import { integrate } from '../numeric';
import { polyfit } from '../numerics/fit';
import { KitError } from '../types';
import { argc, type Table } from './builtinsA';
import { inverse, matmul, transpose } from './ops';
import {
  asInt,
  asMat,
  asNumber,
  colVec,
  empty,
  fromRows,
  mat,
  numel,
  rowVec,
  scalar,
  toRows,
  type M,
  type Value,
} from './values';
import type { Builtin } from './ctx';

const square = (m: M): Mat => {
  if (m.r !== m.c) throw new KitError('mcSquare');
  return toRows(m);
};

function isSymmetric(A: Mat): boolean {
  const scale = Math.max(1e-300, ...A.flat().map(Math.abs));
  return A.every((row, i) => row.every((v, j) => Math.abs(v - A[j][i]) <= 1e-12 * scale));
}

/** The eigenvector sign this console uses: the last nonzero entry is positive. */
function oriented(v: number[]): number[] {
  const last = [...v].reverse().find((x) => Math.abs(x) > 1e-12) ?? 1;
  return last < 0 ? v.map((x) => -x) : v;
}

function eigBuiltin(args: Value[], nargout: number): Value[] {
  argc('eig', args, 1);
  const A = square(asMat(args[0], 'eig'));
  let values: number[];
  let vectors: Mat;
  if (isSymmetric(A)) {
    const e = symmetricEigen(A);
    values = e.values;
    vectors = transposeF(transposeF(e.vectors).map(oriented));
  } else {
    const found = eigenvalues(A);
    if (!found) throw new KitError('mcNoConverge');
    const sorted = sortEigenvalues(found);
    if (sorted.some((z) => z.im !== 0)) throw new KitError('mcComplex');
    values = sorted.map((z) => z.re);
    const cols = values.map((lambda) => realEigenvector(A, lambda));
    if (nargout > 1 && cols.some((c) => c === null)) throw new KitError('mcNoConverge');
    vectors = transposeF(cols.map((c) => oriented(c ?? [])));
  }
  if (nargout <= 1) return [colVec(values)];
  return [fromRows(vectors), fromRows(values.map((v, i) => values.map((_, j) => (i === j ? v : 0))))];
}

function svdBuiltin(args: Value[], nargout: number): Value[] {
  const m = asMat(args[0], 'svd');
  const { U, S, V } = svd(toRows(m));
  if (nargout <= 1) return [colVec(S)];
  return [fromRows(U), fromRows(S.map((s, i) => S.map((_, j) => (i === j ? s : 0)))), fromRows(V)];
}

function luBuiltin(args: Value[], nargout: number): Value[] {
  const A = square(asMat(args[0], 'lu'));
  const n = A.length;
  const f = luFactor(A);
  const L = f.lu.map((row, i) => row.map((v, j) => (i === j ? 1 : j < i ? v : 0)));
  const U = f.lu.map((row, i) => row.map((v, j) => (j >= i ? v : 0)));
  const P = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (f.perm[i] === j ? 1 : 0)));
  if (nargout <= 2) return [matmul(transpose(fromRows(P)), fromRows(L)), fromRows(U)];
  return [fromRows(L), fromRows(U), fromRows(P)];
}

/** Householder QR, with the sign choices LAPACK makes, so R usually has a negative diagonal. */
function qrBuiltin(args: Value[]): Value[] {
  const A = toRows(asMat(args[0], 'qr'));
  const m = A.length;
  const n = A[0].length;
  const R = A.map((row) => row.slice());
  let Q: Mat = identity(m);
  for (let k = 0; k < Math.min(m - 1, n); k++) {
    const x = R.slice(k).map((row) => row[k]);
    const norm = Math.hypot(...x);
    if (norm === 0) continue;
    const alpha = x[0] > 0 ? -norm : norm;
    const v = x.slice();
    v[0] -= alpha;
    const vv = v.reduce((s, a) => s + a * a, 0);
    if (vv === 0) continue;
    for (let j = 0; j < n; j++) {
      const dot = v.reduce((s, a, i) => s + a * R[k + i][j], 0);
      for (let i = 0; i < v.length; i++) R[k + i][j] -= (2 * dot * v[i]) / vv;
    }
    for (let i = 0; i < m; i++) {
      const dot = v.reduce((s, a, j) => s + a * Q[i][k + j], 0);
      for (let j = 0; j < v.length; j++) Q[i][k + j] -= (2 * dot * v[j]) / vv;
    }
  }
  for (let i = 0; i < m; i++) for (let j = 0; j < Math.min(i, n); j++) R[i][j] = 0;
  Q = Q.map((row) => row.slice());
  return [fromRows(Q), fromRows(R)];
}

function cholBuiltin(args: Value[]): Value[] {
  const A = square(asMat(args[0], 'chol'));
  const n = A.length;
  const R: Mat = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let j = 0; j < n; j++) {
    let d = A[j][j];
    for (let k = 0; k < j; k++) d -= R[k][j] ** 2;
    if (!(d > 0)) throw new KitError('mcNotPositiveDefinite');
    R[j][j] = Math.sqrt(d);
    for (let i = j + 1; i < n; i++) {
      let s = A[j][i];
      for (let k = 0; k < j; k++) s -= R[k][j] * R[k][i];
      R[j][i] = s / R[j][j];
    }
  }
  return [fromRows(R)];
}

function normBuiltin(args: Value[]): Value[] {
  argc('norm', args, 1, 2);
  const m = asMat(args[0], 'norm');
  let p: number | 'fro' = 2;
  if (args[1]) {
    const a = asMat(args[1], 'p');
    if (a.str !== undefined) p = a.str.toLowerCase() === 'fro' ? 'fro' : Infinity;
    else p = a.d[0];
  }
  return [scalar(normOf(toRows(m), p))];
}

function nullBuiltin(args: Value[]): Value[] {
  const A = toRows(asMat(args[0], 'null'));
  const Am = fromRows(A);
  const AtA = matmul(transpose(Am), Am);
  const { values, vectors } = symmetricEigen(toRows(AtA));
  const top = Math.max(...values.map(Math.abs), 0);
  const tol = Math.max(A.length, A[0].length) * top * 2.2e-16 * 10;
  const keep = values.map((v, i) => (Math.abs(v) <= tol ? i : -1)).filter((i) => i >= 0);
  if (keep.length === 0) return [empty()];
  return [fromRows(vectors.map((row) => keep.map((j) => row[j])))];
}

function crossDot(args: Value[], isCross: boolean): Value[] {
  const a = asMat(args[0], 'vector');
  const b = asMat(args[1], 'vector');
  if (numel(a) !== numel(b)) throw new KitError('mcDimsAgree');
  if (!isCross) return [scalar(a.d.reduce((s, x, i) => s + x * b.d[i], 0))];
  if (numel(a) !== 3) throw new KitError('mcNeedLength', '3');
  const [x, y, z] = a.d;
  const [u, v, w] = b.d;
  const d = [y * w - z * v, z * u - x * w, x * v - y * u];
  return [a.c === 1 ? colVec(d) : rowVec(d)];
}

function kron(args: Value[]): Value[] {
  const A = asMat(args[0], 'kron');
  const B = asMat(args[1], 'kron');
  const out = mat(A.r * B.r, A.c * B.c, new Array<number>(A.r * B.r * A.c * B.c));
  for (let i = 0; i < A.r; i++)
    for (let j = 0; j < A.c; j++)
      for (let k = 0; k < B.r; k++)
        for (let l = 0; l < B.c; l++) out.d[(i * B.r + k) * out.c + j * B.c + l] = A.d[i * A.c + j] * B.d[k * B.c + l];
  return [out];
}

function diffBuiltin(args: Value[]): Value[] {
  let m = asMat(args[0], 'diff');
  const times = args[1] ? asInt(args[1], 'n') : 1;
  for (let t = 0; t < times; t++) {
    if (m.r === 1 || m.c === 1) {
      const d = m.d.slice(1).map((x, i) => x - m.d[i]);
      m = m.r === 1 ? mat(1, d.length, d) : mat(d.length, 1, d);
    } else {
      const rows = toRows(m);
      m = fromRows(rows.slice(1).map((row, i) => row.map((x, j) => x - rows[i][j])));
    }
  }
  return [m];
}

function trapz(args: Value[]): Value[] {
  const y = asMat(args[args.length - 1], 'y');
  const x = args.length > 1 ? asMat(args[0], 'x') : rowVec(y.d.map((_, i) => i + 1));
  if (numel(x) !== numel(y)) throw new KitError('mcDimsAgree');
  return [scalar(y.d.slice(1).reduce((s, v, i) => s + ((x.d[i + 1] - x.d[i]) * (v + y.d[i])) / 2, 0))];
}

function polyfitBuiltin(args: Value[]): Value[] {
  const x = asMat(args[0], 'x');
  const y = asMat(args[1], 'y');
  const n = asInt(args[2], 'n');
  if (numel(x) !== numel(y)) throw new KitError('mcDimsAgree');
  if (n < 0 || n >= numel(x) + 0) throw new KitError('mcNeedLength', String(n + 1));
  return [rowVec(polyfit(x.d, y.d, n).reverse())];
}

function polyval(args: Value[]): Value[] {
  const p = asMat(args[0], 'p');
  const x = asMat(args[1], 'x');
  return [
    mat(
      x.r,
      x.c,
      x.d.map((v) => p.d.reduce((s, c) => s * v + c, 0)),
    ),
  ];
}

function rootsBuiltin(args: Value[]): Value[] {
  const p = asMat(args[0], 'p').d.slice();
  while (p.length && p[0] === 0) p.shift();
  let zeros = 0;
  while (p.length && p[p.length - 1] === 0) {
    p.pop();
    zeros++;
  }
  if (p.length < 2) return [zeros ? colVec(new Array<number>(zeros).fill(0)) : empty()];
  const n = p.length - 1;
  const C: Mat = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === 0 ? -p[j + 1] / p[0] : j === i - 1 ? 1 : 0)),
  );
  const found = eigenvalues(C);
  if (!found) throw new KitError('mcNoConverge');
  if (found.some((z) => Math.abs(z.im) > 1e-9 * Math.max(1, Math.abs(z.re)))) throw new KitError('mcComplex');
  const real = sortEigenvalues(found)
    .map((z) => z.re)
    .reverse();
  return [colVec([...real, ...new Array<number>(zeros).fill(0)])];
}

function conv(args: Value[]): Value[] {
  const a = asMat(args[0], 'a');
  const b = asMat(args[1], 'b');
  const d = new Array<number>(numel(a) + numel(b) - 1).fill(0);
  a.d.forEach((x, i) => b.d.forEach((y, j) => (d[i + j] += x * y)));
  return [rowVec(d)];
}

function polyder(args: Value[]): Value[] {
  const p = asMat(args[0], 'p').d;
  const n = p.length - 1;
  return [rowVec(n < 1 ? [0] : p.slice(0, n).map((c, i) => c * (n - i)))];
}

function interp1(args: Value[]): Value[] {
  const x = asMat(args[0], 'x').d;
  const y = asMat(args[1], 'y').d;
  const xi = asMat(args[2], 'xi');
  if (x.length !== y.length) throw new KitError('mcDimsAgree');
  const order = x.map((_, i) => i).sort((a, b) => x[a] - x[b]);
  const xs = order.map((i) => x[i]);
  const ys = order.map((i) => y[i]);
  const at = (q: number) => {
    if (q < xs[0] || q > xs[xs.length - 1] || Number.isNaN(q)) return NaN;
    let k = xs.findIndex((v) => v >= q);
    if (k <= 0) k = 1;
    const t = (q - xs[k - 1]) / (xs[k] - xs[k - 1]);
    return ys[k - 1] + t * (ys[k] - ys[k - 1]);
  };
  return [mat(xi.r, xi.c, xi.d.map(at))];
}

function fzero(args: Value[], nargout: number, ctx: Parameters<Builtin>[2]): Value[] {
  const f = (x: number) => asNumber(ctx.call(args[0], [scalar(x)])[0], 'f(x)');
  const start = asMat(args[1], 'x0');
  let [a, b] = start.d.length >= 2 ? [start.d[0], start.d[1]] : [start.d[0], start.d[0]];
  if (start.d.length < 2) {
    let step = a === 0 ? 0.1 : Math.abs(a) * 0.1;
    let found = false;
    for (let k = 0; k < 60 && !found; k++) {
      for (const cand of [a - step, a + step]) {
        if (f(a) * f(cand) <= 0) {
          b = cand;
          found = true;
          break;
        }
      }
      step *= Math.SQRT2 * 1.4;
    }
    if (!found) throw new KitError('mcNoBracket');
  }
  let fa = f(a);
  const fb = f(b);
  if (fa * fb > 0) throw new KitError('mcNoBracket');
  for (let i = 0; i < 300 && Math.abs(b - a) > 1e-15 * Math.max(1, Math.abs(a)); i++) {
    ctx.tick();
    const mid = (a + b) / 2;
    const fm = f(mid);
    if (fm === 0) {
      a = b = mid;
      break;
    }
    if (fa * fm < 0) {
      b = mid;
    } else {
      a = mid;
      fa = fm;
    }
  }
  const x = (a + b) / 2;
  return nargout > 1 ? [scalar(x), scalar(f(x))] : [scalar(x)];
}

export function registerB(t: Table): void {
  const def = (name: string, f: Builtin) => t.set(name, f);
  def('det', (args) => [scalar(determinant(square(asMat(args[0], 'det'))))]);
  def('inv', (args, _n, ctx) => [inverse(asMat(args[0], 'inv'), ctx.say)]);
  def('rank', (args) => [scalar(rankF(toRows(asMat(args[0], 'rank'))))]);
  def('trace', (args) => [scalar(square(asMat(args[0], 'trace')).reduce((s, row, i) => s + row[i], 0))]);
  def('pinv', (args) => [fromRows(pinv(toRows(asMat(args[0], 'pinv'))))]);
  def('cond', (args) => {
    const S = svd(toRows(asMat(args[0], 'cond'))).S;
    return [scalar(S[S.length - 1] === 0 ? Infinity : S[0] / S[S.length - 1])];
  });
  def('rcondApprox', (args) => [scalar(pivotRatio(square(asMat(args[0], 'rcond'))))]);
  def('expm', (args) => [fromRows(expm(square(asMat(args[0], 'expm'))))]);
  def('eig', eigBuiltin);
  def('svd', svdBuiltin);
  def('lu', luBuiltin);
  def('qr', qrBuiltin);
  def('chol', cholBuiltin);
  def('norm', normBuiltin);
  def('null', nullBuiltin);
  def('kron', kron);
  def('cross', (args) => crossDot(args, true));
  def('dot', (args) => crossDot(args, false));
  def('diff', diffBuiltin);
  def('trapz', trapz);
  def('polyfit', polyfitBuiltin);
  def('polyval', polyval);
  def('roots', rootsBuiltin);
  def('conv', conv);
  def('polyder', polyder);
  def('interp1', interp1);
  def('fzero', fzero);
  def('integral', (args, _n, ctx) => {
    const f = (x: number) => asNumber(ctx.call(args[0], [scalar(x)])[0], 'f(x)');
    return [scalar(integrate((x) => (ctx.tick(), f(x)), asNumber(args[1], 'a'), asNumber(args[2], 'b')))];
  });
  def('feval', (args, nargout, ctx) => ctx.call(args[0], args.slice(1), nargout));
  def('arrayfun', (args, _n, ctx) => {
    const x = asMat(args[1], 'x');
    return [
      mat(
        x.r,
        x.c,
        x.d.map((v) => asNumber(ctx.call(args[0], [scalar(v)])[0], 'f(x)')),
      ),
    ];
  });
}
