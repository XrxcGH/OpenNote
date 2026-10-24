// Random processes through linear systems, and the discrete Kalman filter. The linear SDE is dx = Ax dt + B dW,
// where E[dW·dWᵀ] = W dt. Its steady covariance P solves AP + PAᵀ + BWBᵀ = 0. Van Loan's method gives the covariance
// P(t) exactly. Sample paths come from the Euler-Maruyama method with a seeded generator. White noise of two-sided
// density S₀ through G(s) has the density S_y(ω) = |G(jω)|² S₀. The Kalman filter runs the Riccati recursion to its
// steady state and filters a simulated run.
import { ControlError } from '../lib/errors';
import {
  add,
  cols,
  expm,
  eye,
  inv,
  lyap,
  mul,
  normMax,
  rows,
  scale,
  transpose,
  zeros,
  type Mat,
  type ReadonlyMat,
} from '../lib/linalg';
import { seeded, type Random } from '../lib/random';
import { eigenvalues } from '../lib/sim';
import { step, type Step } from '../lib/steps';
import { cabs, evalTF, cx, fmt, isStrictlyProper, polyTex, tfToSS, type TF } from '../lib/tf';
import { integrateToInfinity } from '../lib/num';

export const MAX_STATES = 6;
export const MAX_PATHS = 5000;
export const MAX_STEPS = 2000;

const symmetric = (m: ReadonlyMat): Mat => m.map((row, i) => row.map((x, j) => (x + m[j][i]) / 2));

function checkSquare(a: ReadonlyMat, code: string): void {
  if (!a.length || cols(a) !== rows(a)) throw new ControlError(code);
  if (rows(a) > MAX_STATES) throw new ControlError('tooManyStates', { max: String(MAX_STATES) });
}

/**
 * The lower factor L of a symmetric positive semidefinite M = LLᵀ. A pivot that is round-off leaves its column zero;
 * a negative one means M is not a covariance.
 */
export function cholesky(m: ReadonlyMat, code = 'notCovariance'): Mat {
  const n = rows(m);
  const sizeOf = Math.max(1, normMax(m));
  if (m.some((row, i) => row.some((x, j) => Math.abs(x - m[j][i]) > 1e-9 * sizeOf))) throw new ControlError(code);
  const l = zeros(n, n);
  for (let j = 0; j < n; j += 1) {
    let d = m[j][j];
    for (let k = 0; k < j; k += 1) d -= l[j][k] ** 2;
    if (d < -1e-9 * sizeOf) throw new ControlError(code);
    if (d <= 1e-14 * sizeOf) continue;
    l[j][j] = Math.sqrt(d);
    for (let i = j + 1; i < n; i += 1) {
      let s = m[i][j];
      for (let k = 0; k < j; k += 1) s -= l[i][k] * l[j][k];
      l[i][j] = s / l[j][j];
    }
  }
  return l;
}

export interface Sde {
  readonly a: Mat;
  readonly b: Mat;
  readonly c: Mat;
  /** The noise intensity W, so E[dW·dWᵀ] = W dt. */
  readonly w: Mat;
}

export function makeSde(a: Mat, b: Mat, c: Mat, w: Mat): Sde {
  checkSquare(a, 'notSquare');
  const n = rows(a);
  if (rows(b) !== n) throw new ControlError('bRows', { n: String(n) });
  if (cols(c) !== n) throw new ControlError('cCols', { n: String(n) });
  if (rows(w) !== cols(b) || cols(w) !== cols(b)) throw new ControlError('wShape', { m: String(cols(b)) });
  cholesky(w);
  return { a, b, c, w };
}

/** Q = BWBᵀ, the covariance the noise adds per unit time. */
const noiseOf = (s: Sde): Mat => symmetric(mul(mul(s.b, s.w), transpose(s.b)));

/** Van Loan: over a step h, x[k+1] = Φ x[k] + w[k] with Cov w = Q_d, exactly. */
export function vanLoan(a: ReadonlyMat, q: ReadonlyMat, h: number): { phi: Mat; qd: Mat } {
  const n = rows(a);
  const m = zeros(2 * n, 2 * n);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      m[i][j] = -a[i][j] * h;
      m[i][n + j] = q[i][j] * h;
      m[n + i][n + j] = a[j][i] * h;
    }
  }
  const e = expm(m);
  const phi = transpose(e.slice(n).map((row) => row.slice(n)));
  const f12 = e.slice(0, n).map((row) => row.slice(n));
  return { phi, qd: symmetric(mul(phi, f12)) };
}

export interface Stationary {
  readonly p: Mat;
  readonly outputVariance: number[];
  readonly steps: Step[];
}

/** The steady covariance, or a ControlError 'notStationary' when A has a pole on or right of the imaginary axis. */
export function stationary(s: Sde): Stationary {
  const poles = eigenvalues(s.a);
  if (poles.some((z) => z.re >= -1e-12)) throw new ControlError('notStationary');
  const q = noiseOf(s);
  const p = symmetric(lyap(s.a, q));
  const outputVariance = mul(mul(s.c, p), transpose(s.c)).map((row, i) => row[i]);
  return {
    p,
    outputVariance,
    steps: [
      step('sto.noise', {}, `Q = BWB^T`),
      step('sto.lyapunov', {}, 'AP + PA^T + BWB^T = 0'),
      step('sto.outputVariance', { variance: outputVariance.map((v) => fmt(v)).join(', ') }, '\\sigma_y^2 = C P C^T'),
    ],
  };
}

export interface Paths {
  readonly t: number[];
  /** A few sample paths of the first output. */
  readonly shown: number[][];
  readonly mean: number[];
  readonly sd: number[];
  /** The sample mean and variance of the first output at the end, over every path. */
  readonly endMean: number;
  readonly endVariance: number;
  readonly theoryEndVariance: number;
}

/**
 * Euler-Maruyama paths x ← x + Ax h + B √h L ξ with W = LLᵀ, and the exact mean e^{At}x₀ and variance of the first
 * output by Van Loan's method on the same grid.
 */
export function simulatePaths(
  s: Sde,
  x0: readonly number[],
  span: number,
  steps: number,
  paths: number,
  seed: number,
): Paths {
  const n = rows(s.a);
  if (x0.length !== n) throw new ControlError('x0Length', { n: String(n) });
  if (!(span > 0) || !Number.isFinite(span)) throw new ControlError('spanPositive');
  if (!Number.isInteger(steps) || steps < 10 || steps > MAX_STEPS)
    throw new ControlError('stepsRange', { max: String(MAX_STEPS) });
  if (!Number.isInteger(paths) || paths < 2 || paths > MAX_PATHS)
    throw new ControlError('pathsRange', { max: String(MAX_PATHS) });
  const h = span / steps;
  const lw = cholesky(s.w);
  const m = cols(s.b);
  const rng: Random = seeded(seed);
  const c0 = s.c[0];
  const out = (x: readonly number[]) => c0.reduce((acc, cj, j) => acc + cj * x[j], 0);
  const shown: number[][] = [];
  let sum = 0;
  let sum2 = 0;
  for (let p = 0; p < paths; p += 1) {
    let x = [...x0];
    const keep = p < 3 ? [out(x)] : null;
    for (let k = 0; k < steps; k += 1) {
      const xi = Array.from({ length: m }, () => rng.normal());
      const dw = lw.map((row) => row.reduce((acc, lij, j) => acc + lij * xi[j], 0) * Math.sqrt(h));
      x = x.map((xi0, i) => {
        let drift = 0;
        for (let j = 0; j < n; j += 1) drift += s.a[i][j] * x[j];
        let kick = 0;
        for (let j = 0; j < m; j += 1) kick += s.b[i][j] * dw[j];
        return xi0 + drift * h + kick;
      });
      keep?.push(out(x));
    }
    if (keep) shown.push(keep);
    const y = out(x);
    sum += y;
    sum2 += y * y;
  }
  const { phi, qd } = vanLoan(s.a, noiseOf(s), h);
  const t: number[] = [];
  const mean: number[] = [];
  const sd: number[] = [];
  let mx = [...x0];
  let cov = zeros(n, n);
  for (let k = 0; k <= steps; k += 1) {
    t.push(k * h);
    mean.push(out(mx));
    sd.push(Math.sqrt(Math.max(0, mul(mul([c0], cov), transpose([c0]))[0][0])));
    mx = mul(
      phi,
      mx.map((v) => [v]),
    ).map((r) => r[0]);
    cov = symmetric(add(mul(mul(phi, cov), transpose(phi)), qd));
  }
  const endMean = sum / paths;
  return {
    t,
    shown,
    mean,
    sd,
    endMean,
    endVariance: (sum2 - paths * endMean * endMean) / (paths - 1),
    theoryEndVariance: sd[steps] ** 2,
  };
}

export interface Spectrum {
  readonly variance: number;
  readonly integrated: number;
  readonly w: number[];
  readonly psd: number[];
  readonly tau: number[];
  readonly autocorrelation: number[];
  readonly steps: Step[];
}

/** White noise of two-sided density S₀ through a stable, strictly proper G(s). */
export function spectrum(g: TF, s0: number): Spectrum {
  if (!(s0 > 0) || !Number.isFinite(s0)) throw new ControlError('intensityPositive');
  if (!isStrictlyProper(g)) throw new ControlError('psdProper');
  const ss = tfToSS(g);
  if (eigenvalues(ss.a).some((z) => z.re >= -1e-12)) throw new ControlError('notStationary');
  const p = symmetric(lyap(ss.a, mul(ss.b, transpose(ss.b))));
  const variance = s0 * mul(mul(ss.c, p), transpose(ss.c))[0][0];
  const psdAt = (w: number) => s0 * cabs(evalTF(g, cx(0, w))) ** 2;
  const slowest = Math.min(...eigenvalues(ss.a).map((z) => Math.hypot(z.re, z.im)));
  const fastest = Math.max(...eigenvalues(ss.a).map((z) => Math.hypot(z.re, z.im)));
  // S_y is even, so the integral over the whole axis is twice the integral over ω ≥ 0.
  const integrated = (2 * integrateToInfinity(psdAt, 0, 1e-12, slowest)) / (2 * Math.PI);
  const lo = Math.log10(slowest) - 2;
  const hi = Math.log10(fastest) + 2;
  const w = Array.from({ length: 241 }, (_, k) => 10 ** (lo + ((hi - lo) * k) / 240));
  const decay = Math.min(...eigenvalues(ss.a).map((z) => -z.re));
  const tau = Array.from({ length: 201 }, (_, k) => (k * 8) / decay / 200);
  const pc = mul(p, transpose(ss.c));
  const autocorrelation = tau.map((tt) => s0 * mul(mul(ss.c, expm(scale(ss.a, tt))), pc)[0][0]);
  return {
    variance,
    integrated,
    w,
    psd: w.map(psdAt),
    tau,
    autocorrelation,
    steps: [
      step('sto.psd', { s0: fmt(s0) }, `S_y(\\omega) = |G(j\\omega)|^2 S_0`),
      step('sto.realize', {}, `\\det(sI - A) = ${polyTex(g.den)}`),
      step('sto.lyapunovTf', {}, 'AP + PA^T + BB^T = 0,\\quad \\sigma_y^2 = S_0\\, C P C^T'),
      step('sto.varianceValue', { variance: fmt(variance), integrated: fmt(integrated) }),
      step('sto.autocorrelation', {}, 'R_y(\\tau) = S_0\\, C e^{A\\tau} P C^T,\\ \\tau \\ge 0'),
    ],
  };
}

export interface KalmanRow {
  readonly prior: Mat;
  readonly gain: Mat;
  readonly posterior: Mat;
}

export interface Kalman {
  readonly prior: Mat;
  readonly gain: Mat;
  readonly posterior: Mat;
  readonly iterations: number;
  readonly first: KalmanRow[];
  readonly steps: Step[];
}

export interface KalmanModel {
  readonly f: Mat;
  readonly h: Mat;
  readonly q: Mat;
  readonly r: Mat;
}

export function makeKalman(f: Mat, h: Mat, q: Mat, r: Mat): KalmanModel {
  checkSquare(f, 'fSquare');
  const n = rows(f);
  if (cols(h) !== n) throw new ControlError('hCols', { n: String(n) });
  if (rows(q) !== n || cols(q) !== n) throw new ControlError('qShape', { n: String(n) });
  if (rows(r) !== rows(h) || cols(r) !== rows(h)) throw new ControlError('rkShape', { m: String(rows(h)) });
  cholesky(q, 'qCovariance');
  const lr = cholesky(r, 'rCovariance');
  if (lr.some((row, i) => !(row[i] > 0))) throw new ControlError('rCovariance');
  return { f, h, q, r };
}

/** One Riccati step from the prior: K = P⁻Hᵀ(HP⁻Hᵀ + R)⁻¹, P⁺ = (I − KH)P⁻, then the next prior FP⁺Fᵀ + Q. */
function update(m: KalmanModel, prior: ReadonlyMat): KalmanRow & { next: Mat } {
  const ht = transpose(m.h);
  const sInv = inv(add(mul(mul(m.h, prior), ht), m.r));
  const gain = mul(mul(prior, ht), sInv);
  const posterior = symmetric(mul(add(eye(rows(prior)), mul(gain, m.h), -1), prior));
  const next = symmetric(add(mul(mul(m.f, posterior), transpose(m.f)), m.q));
  return { prior: prior.map((row) => [...row]), gain, posterior, next };
}

/** The Riccati recursion from P₀⁻ until the prior settles; ControlError 'kalmanNoConverge' if it does not. */
export function steadyKalman(m: KalmanModel, p0: ReadonlyMat): Kalman {
  const first: KalmanRow[] = [];
  let prior: Mat = p0.map((row) => [...row]);
  for (let it = 1; it <= 100000; it += 1) {
    const r = update(m, prior);
    if (first.length < 8) first.push(r);
    const change = normMax(add(r.next, prior, -1));
    if (!r.next.flat().every(Number.isFinite)) break;
    prior = r.next;
    if (change <= 1e-13 * Math.max(1, normMax(prior))) {
      const fin = update(m, prior);
      return {
        prior,
        gain: fin.gain,
        posterior: fin.posterior,
        iterations: it,
        first,
        steps: [
          step('sto.kalmanModel', {}, 'x_{k+1} = F x_k + w_k,\\quad z_k = H x_k + v_k'),
          step('sto.kalmanGain', {}, 'K_k = P_k^- H^T \\left(H P_k^- H^T + R\\right)^{-1}'),
          step('sto.kalmanPosterior', {}, 'P_k^+ = (I - K_k H) P_k^-'),
          step('sto.kalmanPrior', {}, 'P_{k+1}^- = F P_k^+ F^T + Q'),
          step('sto.kalmanSteady', { iterations: String(it) }),
        ],
      };
    }
  }
  throw new ControlError('kalmanNoConverge');
}

export interface KalmanRun {
  readonly truth: number[];
  readonly measured: number[];
  readonly estimate: number[];
  readonly bound: number[];
  readonly rmsMeasured: number;
  readonly rmsEstimate: number;
}

/** A simulated run: the truth from x₀, noisy measurements, and the filter's estimate of the first state from x̂ = 0. */
export function runKalman(
  m: KalmanModel,
  p0: ReadonlyMat,
  x0: readonly number[],
  samples: number,
  seed: number,
): KalmanRun {
  const n = rows(m.f);
  if (x0.length !== n) throw new ControlError('x0Length', { n: String(n) });
  if (!Number.isInteger(samples) || samples < 2 || samples > MAX_STEPS) {
    throw new ControlError('kalmanSamples', { max: String(MAX_STEPS) });
  }
  const rng = seeded(seed);
  const lq = cholesky(m.q);
  const lr = cholesky(m.r);
  const draw = (l: Mat) => {
    const xi = l.map(() => rng.normal());
    return l.map((row) => row.reduce((acc, v, j) => acc + v * xi[j], 0));
  };
  const col = (v: readonly number[]) => v.map((x) => [x]);
  const flat = (v: Mat) => v.map((row) => row[0]);
  let x = [...x0];
  let xhat = new Array<number>(n).fill(0);
  let prior: Mat = p0.map((row) => [...row]);
  const out: KalmanRun = { truth: [], measured: [], estimate: [], bound: [], rmsMeasured: 0, rmsEstimate: 0 };
  let se = 0;
  let sm = 0;
  const measurable = rows(m.h) === 1 && m.h[0].every((v, j) => (j === 0 ? v !== 0 : v === 0));
  for (let k = 0; k < samples; k += 1) {
    const z = add(mul(m.h, col(x)), col(draw(lr)));
    const r = update(m, prior);
    const innovation = add(z, mul(m.h, col(xhat)), -1);
    const post = add(col(xhat), mul(r.gain, innovation));
    out.truth.push(x[0]);
    out.estimate.push(post[0][0]);
    out.bound.push(2 * Math.sqrt(Math.max(0, r.posterior[0][0])));
    const zFirst = measurable ? z[0][0] / m.h[0][0] : Number.NaN;
    out.measured.push(zFirst);
    se += (post[0][0] - x[0]) ** 2;
    if (measurable) sm += (zFirst - x[0]) ** 2;
    xhat = flat(mul(m.f, post));
    prior = r.next;
    x = flat(add(mul(m.f, col(x)), col(draw(lq))));
  }
  return {
    ...out,
    rmsEstimate: Math.sqrt(se / samples),
    rmsMeasured: measurable ? Math.sqrt(sm / samples) : Number.NaN,
  };
}
