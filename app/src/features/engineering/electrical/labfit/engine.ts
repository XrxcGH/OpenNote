// Weighted least-squares fits for lab data: linear-in-parameters models by Householder QR, nonlinear models by
// Levenberg-Marquardt with a numerical Jacobian, the parameter covariance, chi-square, and its p-value. Pure.
import { fail, readNumber, solveReal } from '../shared';

export interface Data {
  x: number[];
  y: number[];
  /** The uncertainty of each y, or null when the data came without any. */
  sigma: number[] | null;
}

/** Reads rows of "x y [sigma]" separated by spaces, commas, semicolons, or tabs. A first row of words is a header. */
export function parseData(text: string): Data {
  const x: number[] = [];
  const y: number[] = [];
  const sigma: number[] = [];
  let withSigma: boolean | null = null;
  text.split('\n').forEach((raw, index) => {
    const stripped = raw.replace(/#.*/, '').trim();
    if (stripped === '') return;
    const parts = stripped.split(/[\s,;]+/).filter((w) => w !== '');
    const nums = parts.map((w) => readNumber(w));
    const line = String(index + 1);
    if (nums.some((v) => v === null || !Number.isFinite(v))) {
      if (x.length === 0 && index === 0) return;
      fail('fitDataNumber', { line });
    }
    if (nums.length < 2 || nums.length > 3) fail('fitDataCount', { line });
    const has = nums.length === 3;
    if (withSigma !== null && withSigma !== has) fail('fitDataMixed', { line });
    withSigma = has;
    x.push(nums[0]!);
    y.push(nums[1]!);
    if (has) {
      if (nums[2]! <= 0) fail('fitDataSigma', { line });
      sigma.push(nums[2]!);
    }
  });
  if (x.length < 2) fail('fitDataFew');
  return { x, y, sigma: withSigma ? sigma : null };
}

// ---- Linear least squares ----

export interface Fit {
  coef: number[];
  /** Covariance of the parameters, already scaled by the reduced chi-square when no sigma was given. */
  cov: number[][];
  chi2: number;
  dof: number;
  /** True when the covariance was scaled by the scatter because the data had no uncertainties. */
  scaled: boolean;
  fitted: number[];
  residuals: number[];
}

/** Solves min |A c - b| by Householder QR and returns the coefficients and (A^T A)^-1. */
function qrLeastSquares(a: number[][], b: number[]): { coef: number[]; inv: number[][] } {
  const m = a.length;
  const n = a[0]!.length;
  const r = a.map((row) => [...row]);
  const qb = [...b];
  for (let k = 0; k < n; k++) {
    let norm = 0;
    for (let i = k; i < m; i++) norm = Math.hypot(norm, r[i]![k]!);
    if (norm === 0) fail('fitSingular');
    const alpha = r[k]![k]! > 0 ? -norm : norm;
    const v = Array.from({ length: m - k }, (_, i) => r[k + i]![k]!);
    v[0]! -= alpha;
    const vv = v.reduce((s, e) => s + e * e, 0);
    if (vv === 0) continue;
    for (let j = k; j < n; j++) {
      let dot = 0;
      for (let i = 0; i < v.length; i++) dot += v[i]! * r[k + i]![j]!;
      const f = (2 * dot) / vv;
      for (let i = 0; i < v.length; i++) r[k + i]![j]! -= f * v[i]!;
    }
    let dot = 0;
    for (let i = 0; i < v.length; i++) dot += v[i]! * qb[k + i]!;
    const f = (2 * dot) / vv;
    for (let i = 0; i < v.length; i++) qb[k + i]! -= f * v[i]!;
  }
  const big = Math.max(...Array.from({ length: n }, (_, k) => Math.abs(r[k]![k]!)));
  for (let k = 0; k < n; k++) if (Math.abs(r[k]![k]!) <= 1e-12 * big) fail('fitSingular');
  const coef = Array.from({ length: n }, () => 0);
  for (let k = n - 1; k >= 0; k--) {
    let sum = qb[k]!;
    for (let j = k + 1; j < n; j++) sum -= r[k]![j]! * coef[j]!;
    coef[k] = sum / r[k]![k]!;
  }
  // R^-1 by back substitution on the columns of the identity; (A^T A)^-1 = R^-1 R^-T.
  const rinv = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
  for (let c = 0; c < n; c++) {
    for (let k = c; k >= 0; k--) {
      let sum = k === c ? 1 : 0;
      for (let j = k + 1; j <= c; j++) sum -= r[k]![j]! * rinv[j]![c]!;
      rinv[k]![c] = sum / r[k]![k]!;
    }
  }
  const inv = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      let s = 0;
      for (let k = Math.max(i, j); k < n; k++) s += rinv[i]![k]! * rinv[j]![k]!;
      return s;
    }),
  );
  return { coef, inv };
}

/**
 * Weighted linear least squares for y = sum c_j basis_j(x). Each row is divided by its sigma. With no sigma the
 * covariance is scaled by chi2 / (N - p), the scatter of the points about the fit.
 */
export function linearFit(basis: (x: number) => number[], data: Data): Fit {
  const n = data.x.length;
  const sig = data.sigma ?? data.x.map(() => 1);
  const rows = data.x.map((x, i) => basis(x).map((v) => v / sig[i]!));
  const p = rows[0]!.length;
  if (n < p) fail('fitTooFew', { have: String(n), need: String(p) });
  const { coef, inv } = qrLeastSquares(
    rows,
    data.y.map((v, i) => v / sig[i]!),
  );
  const fitted = data.x.map((x) => basis(x).reduce((s, v, j) => s + v * coef[j]!, 0));
  const residuals = data.y.map((v, i) => v - fitted[i]!);
  const chi2 = residuals.reduce((s, r, i) => s + (r / sig[i]!) ** 2, 0);
  const dof = n - p;
  const scaled = data.sigma === null;
  if (scaled && dof <= 0) fail('fitNoScatter');
  const scale = scaled ? chi2 / dof : 1;
  return { coef, cov: inv.map((row) => row.map((v) => v * scale)), chi2, dof, scaled, fitted, residuals };
}

export const polynomialBasis =
  (degree: number) =>
  (x: number): number[] =>
    Array.from({ length: degree + 1 }, (_, k) => x ** k);

// ---- Nonlinear least squares ----

export type Model = (x: number, p: number[]) => number;

export interface NonlinearFit extends Fit {
  iterations: number;
}

type Matrix = number[][];

/** The weighted residuals (y - f) / sigma at a parameter vector; a model value that is not a number is an error. */
function residualsOf(model: Model, data: Data, sig: number[], q: number[]): number[] {
  return data.x.map((x, i) => {
    const v = model(x, q);
    if (!Number.isFinite(v)) fail('fitModelValue', { x: String(x) });
    return (data.y[i]! - v) / sig[i]!;
  });
}

/** The Jacobian of the weighted model values, by central differences. */
function numericJacobian(model: Model, data: Data, sig: number[], q: number[]): Matrix {
  const jac: Matrix = data.x.map(() => q.map(() => 0));
  q.forEach((value, k) => {
    const h = 6e-6 * Math.max(Math.abs(value), 1e-3);
    const up = [...q];
    const down = [...q];
    up[k]! += h;
    down[k]! -= h;
    const a = residualsOf(model, data, sig, up);
    const b = residualsOf(model, data, sig, down);
    // The residual is (y - f) / sigma, so the slope of f is minus its slope.
    for (let i = 0; i < jac.length; i++) jac[i]![k] = -(a[i]! - b[i]!) / (2 * h);
  });
  return jac;
}

const normalMatrix = (jac: Matrix, p: number): Matrix =>
  Array.from({ length: p }, (_, a) =>
    Array.from({ length: p }, (_, b) => jac.reduce((s, row) => s + row[a]! * row[b]!, 0)),
  );

const sumSquares = (r: number[]): number => r.reduce((s, v) => s + v * v, 0);

interface Trial {
  q: number[];
  res: number[];
  chi2: number;
  small: boolean;
}

/** One damped Gauss-Newton step; null when no damping gives a lower chi-square. */
function tryStep(model: Model, data: Data, sig: number[], q: number[], res: number[], chi2: number, lambda: number) {
  const jac = numericJacobian(model, data, sig, q);
  const g = q.map((_, k) => jac.reduce((s, row, i) => s + row[k]! * res[i]!, 0));
  const h = normalMatrix(jac, q.length);
  let damping = lambda;
  for (let attempt = 0; attempt < 30; attempt++, damping *= 10) {
    const damped = h.map((row, a) => row.map((v, b) => (a === b ? v + damping * Math.max(h[a]![a]!, 1e-300) : v)));
    const step = solveReal(damped, g);
    if (!step) continue;
    const trial = q.map((v, k) => v + step[k]!);
    let next: number[];
    try {
      next = residualsOf(model, data, sig, trial);
    } catch {
      continue;
    }
    const trialChi = sumSquares(next);
    if (trialChi > chi2) continue;
    const small = step.every((s, k) => Math.abs(s) <= 1e-13 * (Math.abs(q[k]!) + 1e-12));
    const result: Trial = {
      q: trial,
      res: next,
      chi2: trialChi,
      small: small || chi2 - trialChi <= 1e-15 * chi2 || trialChi < 1e-28,
    };
    return { result, lambda: Math.max(damping / 10, 1e-12) };
  }
  return null;
}

/** Levenberg-Marquardt from a starting guess; the Jacobian is found by central differences. */
export function levenbergMarquardt(model: Model, data: Data, start: number[]): NonlinearFit {
  const n = data.x.length;
  const p = start.length;
  if (n < p) fail('fitTooFew', { have: String(n), need: String(p) });
  const sig = data.sigma ?? data.x.map(() => 1);
  let q = [...start];
  let res = residualsOf(model, data, sig, q);
  let chi2 = sumSquares(res);
  let lambda = 1e-3;
  let iterations = 0;
  let settled = false;
  while (iterations < 500 && !settled) {
    iterations++;
    const step = tryStep(model, data, sig, q, res, chi2, lambda);
    if (!step) break;
    ({ q, res, chi2 } = step.result);
    settled = step.result.small;
    lambda = step.lambda;
  }
  if (!settled && iterations >= 500) fail('fitNoConverge');
  const jtj = normalMatrix(numericJacobian(model, data, sig, q), p);
  const cov: Matrix = jtj.map(() => jtj.map(() => 0));
  for (let c = 0; c < p; c++) {
    const col = solveReal(
      jtj,
      jtj.map((_, i) => (i === c ? 1 : 0)),
    );
    if (!col) return fail('fitSingular');
    col.forEach((v, r) => {
      cov[r]![c] = v;
    });
  }
  const dof = n - p;
  const scaled = data.sigma === null;
  if (scaled && dof <= 0) fail('fitNoScatter');
  const scale = scaled ? chi2 / dof : 1;
  const fitted = data.x.map((x) => model(x, q));
  return {
    coef: q,
    cov: cov.map((row) => row.map((v) => v * scale)),
    chi2,
    dof,
    scaled,
    fitted,
    residuals: data.y.map((v, i) => v - fitted[i]!),
    iterations,
  };
}

// ---- Statistics ----

function logGamma(z: number): number {
  // Lanczos approximation, g = 7 and 9 terms: good to about 1e-15.
  const c = [
    0.9999999999998099, 676.5203681218851, -1259.139216722403, 771.3234287776531, -176.6150291621406, 12.50734327868691,
    -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7,
  ];
  const w = z - 1;
  let series = c[0]!;
  for (let i = 1; i < c.length; i++) series += c[i]! / (w + i);
  const t = w + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (w + 0.5) * Math.log(t) - t + Math.log(series);
}

/** The regularized upper incomplete gamma function Q(a, x). */
export function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  const front = Math.exp(-x + a * Math.log(x) - logGamma(a));
  if (x < a + 1) {
    let sum = 1 / a;
    let term = sum;
    for (let n = 1; n < 1000; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-16) break;
    }
    return 1 - sum * front;
  }
  let b = x + 1 - a;
  let c = 1 / 1e-300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return front * h;
}

/** The chance of a chi-square this large or larger from the scatter alone, with this many degrees of freedom. */
export const chiSquareP = (chi2: number, dof: number): number => gammaQ(dof / 2, chi2 / 2);

/** R squared: the share of the variance of y that the fit explains. */
export function rSquared(y: number[], fitted: number[]): number {
  const mean = y.reduce((s, v) => s + v, 0) / y.length;
  const total = y.reduce((s, v) => s + (v - mean) ** 2, 0);
  const left = y.reduce((s, v, i) => s + (v - fitted[i]!) ** 2, 0);
  return total === 0 ? 1 : 1 - left / total;
}

/** The value of a model at x and its uncertainty from the parameter covariance: u^2 = g^T C g. */
export function predict(model: Model, p: number[], cov: number[][], x: number) {
  const y = model(x, p);
  const g = p.map((v, k) => {
    const h = 6e-6 * Math.max(Math.abs(v), 1e-3);
    const up = [...p];
    const down = [...p];
    up[k]! += h;
    down[k]! -= h;
    return (model(x, up) - model(x, down)) / (2 * h);
  });
  let variance = 0;
  for (let i = 0; i < p.length; i++) for (let j = 0; j < p.length; j++) variance += g[i]! * cov[i]![j]! * g[j]!;
  return { y, u: Math.sqrt(Math.max(0, variance)) };
}

// ---- Straight line: the closed form a student works by hand ----

export interface LineSums {
  s: number;
  sx: number;
  sy: number;
  sxx: number;
  sxy: number;
  delta: number;
  intercept: number;
  slope: number;
  uIntercept: number;
  uSlope: number;
}

/** The weighted sums and closed-form line: slope = (S Sxy - Sx Sy) / delta, and so on. */
export function lineSums(data: Data): LineSums {
  const sig = data.sigma ?? data.x.map(() => 1);
  let s = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  data.x.forEach((x, i) => {
    const w = 1 / sig[i]! ** 2;
    s += w;
    sx += w * x;
    sy += w * data.y[i]!;
    sxx += w * x * x;
    sxy += w * x * data.y[i]!;
  });
  const delta = s * sxx - sx * sx;
  if (Math.abs(delta) <= 1e-14 * Math.abs(s * sxx)) fail('fitSingular');
  return {
    s,
    sx,
    sy,
    sxx,
    sxy,
    delta,
    intercept: (sxx * sy - sx * sxy) / delta,
    slope: (s * sxy - sx * sy) / delta,
    uIntercept: Math.sqrt(sxx / delta),
    uSlope: Math.sqrt(s / delta),
  };
}
