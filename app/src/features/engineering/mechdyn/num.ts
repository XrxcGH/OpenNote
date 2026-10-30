// Small numerics the mechanisms and dynamics tools share: an adaptive Dormand-Prince 5(4) integrator with event
// location, Brent's root finder with a bracket scan, a symmetric Jacobi eigen solver (plain and generalized), and a
// dense linear solve. Pure functions with no interface text, written from the published algorithms.

export type Vec = number[];
export type Mat = number[][];
export type Rhs = (t: number, y: readonly number[]) => number[];

// Dormand and Prince (1980) coefficients.
const C2 = 1 / 5,
  C3 = 3 / 10,
  C4 = 4 / 5,
  C5 = 8 / 9;
const A21 = 1 / 5;
const A31 = 3 / 40,
  A32 = 9 / 40;
const A41 = 44 / 45,
  A42 = -56 / 15,
  A43 = 32 / 9;
const A51 = 19372 / 6561,
  A52 = -25360 / 2187,
  A53 = 64448 / 6561,
  A54 = -212 / 729;
const A61 = 9017 / 3168,
  A62 = -355 / 33,
  A63 = 46732 / 5247,
  A64 = 49 / 176,
  A65 = -5103 / 18656;
const B1 = 35 / 384,
  B3 = 500 / 1113,
  B4 = 125 / 192,
  B5 = -2187 / 6784,
  B6 = 11 / 84;
const E1 = 71 / 57600,
  E3 = -71 / 16695,
  E4 = 71 / 1920,
  E5 = -17253 / 339200,
  E6 = 22 / 525,
  E7 = -1 / 40;

const axpy = (y: readonly number[], h: number, terms: readonly [number, readonly number[]][]): number[] =>
  y.map((v, i) => v + h * terms.reduce((sum, [c, k]) => sum + c * k[i], 0));

/** One Dormand-Prince step: the fifth-order value, the error estimate, and the slope at the end (FSAL). */
export function dopriStep(f: Rhs, t: number, y: readonly number[], h: number, k1: readonly number[]) {
  const k2 = f(t + C2 * h, axpy(y, h, [[A21, k1]]));
  const k3 = f(
    t + C3 * h,
    axpy(y, h, [
      [A31, k1],
      [A32, k2],
    ]),
  );
  const k4 = f(
    t + C4 * h,
    axpy(y, h, [
      [A41, k1],
      [A42, k2],
      [A43, k3],
    ]),
  );
  const k5 = f(
    t + C5 * h,
    axpy(y, h, [
      [A51, k1],
      [A52, k2],
      [A53, k3],
      [A54, k4],
    ]),
  );
  const k6 = f(
    t + h,
    axpy(y, h, [
      [A61, k1],
      [A62, k2],
      [A63, k3],
      [A64, k4],
      [A65, k5],
    ]),
  );
  const next = axpy(y, h, [
    [B1, k1],
    [B3, k3],
    [B4, k4],
    [B5, k5],
    [B6, k6],
  ]);
  const k7 = f(t + h, next);
  const err = y.map((_, i) => h * (E1 * k1[i] + E3 * k3[i] + E4 * k4[i] + E5 * k5[i] + E6 * k6[i] + E7 * k7[i]));
  return { next, err, k7 };
}

export interface OdeOptions {
  rtol?: number;
  atol?: number;
  /** Largest step, so plots get enough points. */
  hmax?: number;
  maxSteps?: number;
  /** Event functions: a sign change between steps is located and recorded. */
  events?: ((t: number, y: readonly number[]) => number)[];
  /** Stop at the first event of this index. */
  terminal?: number;
}

export interface OdeEvent {
  index: number;
  t: number;
  y: number[];
}

export interface OdeSolution {
  t: number[];
  y: number[][];
  events: OdeEvent[];
  /** False when the step count ran out or the step size collapsed. */
  ok: boolean;
}

/** Integrates y' = f(t, y) from t0 to t1 with error control on every component. */
export function dopri(f: Rhs, t0: number, y0: readonly number[], t1: number, opts: OdeOptions = {}): OdeSolution {
  const rtol = opts.rtol ?? 1e-8;
  const atol = opts.atol ?? 1e-10;
  const span = t1 - t0;
  const hmax = Math.min(Math.abs(opts.hmax ?? span), Math.abs(span));
  const maxSteps = opts.maxSteps ?? 200000;
  const events = opts.events ?? [];
  const out: OdeSolution = { t: [t0], y: [[...y0]], events: [], ok: true };
  if (span === 0) return out;
  const dir = Math.sign(span);
  let t = t0;
  let y = [...y0];
  let k1 = f(t, y);
  let h = dir * Math.min(hmax, Math.abs(span) / 100);
  let g = events.map((e) => e(t, y));
  for (let n = 0; n < maxSteps; n += 1) {
    if (dir * (t + h - t1) > 0) h = t1 - t;
    const { next, err, k7 } = dopriStep(f, t, y, h, k1);
    let norm = 0;
    for (let i = 0; i < y.length; i += 1) {
      const scale = atol + rtol * Math.max(Math.abs(y[i]), Math.abs(next[i]));
      norm += (err[i] / scale) ** 2;
    }
    norm = Math.sqrt(norm / Math.max(1, y.length));
    if (!Number.isFinite(norm)) {
      out.ok = false;
      return out;
    }
    if (norm <= 1) {
      const gNext = events.map((e) => e(t + h, next));
      let stop = false;
      for (let i = 0; i < events.length; i += 1) {
        if (g[i] !== 0 && Math.sign(gNext[i]) !== Math.sign(g[i]) && gNext[i] !== 0) {
          const hs = locate((s) => events[i](t + s, dopriStep(f, t, y, s, k1).next), 0, h, g[i], gNext[i]);
          const ys = dopriStep(f, t, y, hs, k1).next;
          out.events.push({ index: i, t: t + hs, y: ys });
          if (opts.terminal === i) {
            out.t.push(t + hs);
            out.y.push(ys);
            return out;
          }
        } else if (gNext[i] === 0 && g[i] !== 0) {
          out.events.push({ index: i, t: t + h, y: [...next] });
          if (opts.terminal === i) stop = true;
        }
      }
      t += h;
      y = next;
      k1 = k7;
      g = gNext.map((v, i) => (v === 0 ? g[i] : v));
      out.t.push(t);
      out.y.push(y);
      if (stop || dir * (t - t1) >= 0) return out;
    }
    const factor = norm === 0 ? 5 : Math.min(5, Math.max(0.2, 0.9 * norm ** -0.2));
    h = dir * Math.min(hmax, Math.abs(h) * factor);
    if (Math.abs(h) < 1e-14 * Math.max(1, Math.abs(t))) {
      out.ok = false;
      return out;
    }
  }
  out.ok = false;
  return out;
}

/** Root of g on [a, b] given the end values, by the Illinois false-position method with a bisection guard. */
function locate(g: (s: number) => number, a: number, b: number, ga: number, gb: number): number {
  let lo = a,
    hi = b,
    glo = ga,
    ghi = gb;
  let side = 0;
  for (let i = 0; i < 80; i += 1) {
    let s = hi - (ghi * (hi - lo)) / (ghi - glo);
    if (!(s > Math.min(lo, hi) && s < Math.max(lo, hi))) s = (lo + hi) / 2;
    const gs = g(s);
    if (gs === 0 || Math.abs(hi - lo) < 1e-15 * Math.max(1, Math.abs(hi))) return s;
    if (Math.sign(gs) === Math.sign(ghi)) {
      hi = s;
      ghi = gs;
      if (side === -1) glo /= 2;
      side = -1;
    } else {
      lo = s;
      glo = gs;
      if (side === 1) ghi /= 2;
      side = 1;
    }
  }
  return (lo + hi) / 2;
}

/** Brent's method on a bracket [a, b] with f(a) and f(b) of opposite sign; null when they are not. */
export function brent(f: (x: number) => number, a: number, b: number, tol = 1e-13): number | null {
  let fa = f(a),
    fb = f(b);
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (!(Math.sign(fa) !== Math.sign(fb))) return null;
  let c = a,
    fc = fa,
    d = b - a,
    e = d;
  for (let i = 0; i < 200; i += 1) {
    if (Math.sign(fb) === Math.sign(fc)) {
      c = a;
      fc = fa;
      d = b - a;
      e = d;
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b;
      b = c;
      c = a;
      fa = fb;
      fb = fc;
      fc = fa;
    }
    const tol1 = 2 * Number.EPSILON * Math.abs(b) + 0.5 * tol;
    const m = 0.5 * (c - b);
    if (Math.abs(m) <= tol1 || fb === 0) return b;
    if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa;
      let p: number, q: number;
      if (a === c) {
        p = 2 * m * s;
        q = 1 - s;
      } else {
        const qq = fa / fc,
          r = fb / fc;
        p = s * (2 * m * qq * (qq - r) - (b - a) * (r - 1));
        q = (qq - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q;
      p = Math.abs(p);
      if (2 * p < Math.min(3 * m * q - Math.abs(tol1 * q), Math.abs(e * q))) {
        e = d;
        d = p / q;
      } else {
        d = m;
        e = d;
      }
    } else {
      d = m;
      e = d;
    }
    a = b;
    fa = fb;
    b += Math.abs(d) > tol1 ? d : Math.sign(m) * tol1;
    fb = f(b);
  }
  return b;
}

/** Every sign change of f on a grid of n cells over [a, b], each refined by Brent. */
export function bracketScan(f: (x: number) => number, a: number, b: number, n = 400): number[] {
  const roots: number[] = [];
  let x0 = a,
    f0 = f(a);
  for (let i = 1; i <= n; i += 1) {
    const x1 = a + ((b - a) * i) / n;
    const f1 = f(x1);
    if (Number.isFinite(f0) && Number.isFinite(f1) && Math.sign(f0) !== Math.sign(f1)) {
      const r = f0 === 0 ? x0 : brent(f, x0, x1);
      if (r !== null && (roots.length === 0 || Math.abs(r - roots[roots.length - 1]) > 1e-9)) roots.push(r);
    }
    x0 = x1;
    f0 = f1;
  }
  return roots;
}

/** Solves A x = b by Gaussian elimination with partial pivoting; null when A is singular. */
export function solve(A: readonly (readonly number[])[], b: readonly number[]): number[] | null {
  const n = b.length;
  const m = A.map((row, i) => [...row, b[i]]);
  const scale = Math.max(1e-300, ...A.flat().map(Math.abs));
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) <= 1e-13 * scale) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = col + 1; r < n; r += 1) {
      const factor = m[r][col] / m[col][col];
      for (let c = col; c <= n; c += 1) m[r][c] -= factor * m[col][c];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r -= 1) {
    let sum = m[r][n];
    for (let c = r + 1; c < n; c += 1) sum -= m[r][c] * x[c];
    x[r] = sum / m[r][r];
  }
  return x;
}

export const matMul = (A: Mat, B: Mat): Mat =>
  A.map((row) => B[0].map((_, j) => row.reduce((s, v, k) => s + v * B[k][j], 0)));
export const matVec = (A: Mat, x: readonly number[]): Vec => A.map((row) => row.reduce((s, v, k) => s + v * x[k], 0));
export const transpose = (A: Mat): Mat => A[0].map((_, j) => A.map((row) => row[j]));
export const identity = (n: number): Mat =>
  Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));

export interface SymEigen {
  /** Ascending. */
  values: number[];
  /** Columns are the eigenvectors, in the order of values. */
  vectors: Mat;
}

/** Eigenvalues and orthonormal eigenvectors of a symmetric matrix by cyclic Jacobi rotations. */
export function symEigen(input: readonly (readonly number[])[]): SymEigen {
  const n = input.length;
  const a = input.map((row) => [...row]);
  const v = identity(n);
  for (let sweep = 0; sweep < 100; sweep += 1) {
    let off = 0;
    for (let p = 0; p < n; p += 1) for (let q = p + 1; q < n; q += 1) off += a[p][q] ** 2;
    if (
      off <
      1e-30 *
        Math.max(
          1e-300,
          a.flat().reduce((s, x) => s + x * x, 0),
        )
    )
      break;
    for (let p = 0; p < n; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        if (a[p][q] === 0) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k += 1) {
          const akp = a[k][p],
            akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k += 1) {
          const apk = a[p][k],
            aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k += 1) {
          const vkp = v[k][p],
            vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const order = a.map((row, i) => [row[i], i] as const).sort((x, y) => x[0] - y[0]);
  return { values: order.map(([value]) => value), vectors: v.map((row) => order.map(([, i]) => row[i])) };
}

/** Lower Cholesky factor of a symmetric positive-definite matrix, or null. */
export function cholesky(A: readonly (readonly number[])[]): Mat | null {
  const n = A.length;
  const L = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let sum = A[i][j];
      for (let k = 0; k < j; k += 1) sum -= L[i][k] * L[j][k];
      if (i === j) {
        if (!(sum > 0)) return null;
        L[i][i] = Math.sqrt(sum);
      } else L[i][j] = sum / L[j][j];
    }
  }
  return L;
}

/** K phi = lambda M phi for symmetric K and positive-definite M; vectors are M-normalized (phi' M phi = 1). */
export function generalizedEigen(K: Mat, M: Mat): SymEigen | null {
  const L = cholesky(M);
  if (!L) return null;
  const n = K.length;
  // Columns of L^-1 by forward substitution on each unit vector, then A = L^-1 K L^-T.
  const columns = identity(n).map((e) => {
    const x = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i += 1) {
      let s = e[i];
      for (let k = 0; k < i; k += 1) s -= L[i][k] * x[k];
      x[i] = s / L[i][i];
    }
    return x;
  });
  const Li = transpose(columns);
  const A = matMul(matMul(Li, K), columns);
  const sym = A.map((row, i) => row.map((x, j) => (x + A[j][i]) / 2));
  const { values, vectors } = symEigen(sym);
  return { values, vectors: matMul(columns, vectors) };
}

/** Central-difference derivative of a scalar function. */
export const derivative = (f: (x: number) => number, x: number, h = 1e-5 * Math.max(1, Math.abs(x))) =>
  (f(x + h) - f(x - h)) / (2 * h);

export const deg = (rad: number) => (rad * 180) / Math.PI;
export const rad = (degrees: number) => (degrees * Math.PI) / 180;

/** An angle in radians folded into (-pi, pi]. */
export function wrap(angle: number): number {
  let a = angle % (2 * Math.PI);
  if (a <= -Math.PI) a += 2 * Math.PI;
  if (a > Math.PI) a -= 2 * Math.PI;
  return a;
}
