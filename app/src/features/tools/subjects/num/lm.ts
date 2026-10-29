// Weighted nonlinear least squares by Levenberg-Marquardt: Marquardt's scaled damping (the diagonal of JᵀWJ) with
// Nielsen's update of the damping factor, a central-difference Jacobian unless the caller supplies one, and box
// bounds kept by projecting each trial step. At the answer it reports the parameter covariance s²(JᵀWJ)⁻¹ and gives
// confidence and prediction bands by the delta method. Pure: no DOM.
import { cholesky, choleskySolve, identity } from '../../kits/num/matrix';
import type { Matrix } from '../../kits/num/matrix';
import { tQuantile } from '../stats/dist';
import { SubjectError, ensure } from '../errors';

/** The model: the predicted response at one data point `x` for parameters `p`. */
export type Model<X> = (x: X, p: readonly number[]) => number;

export interface LmOptions<X> {
  /** One weight per point (inverse variances); all ones when left out. */
  weights?: readonly number[];
  /** The model's gradient with respect to the parameters at one point; central differences when left out. */
  gradient?: (x: X, p: readonly number[]) => number[];
  lower?: readonly number[];
  upper?: readonly number[];
  maxIterations?: number;
  /** Stops when the step is this small relative to the parameters, or the gradient this small. */
  tolerance?: number;
}

export type LmStop = 'gradient' | 'step' | 'maxIterations';

export interface LmFit {
  params: number[];
  /** Observed minus fitted, unweighted. */
  residuals: number[];
  /** Weighted sum of squared residuals. */
  ssr: number;
  dof: number;
  /** The residual variance ssr / dof (NaN with no degrees of freedom left). */
  s2: number;
  covariance: Matrix;
  se: number[];
  iterations: number;
  converged: boolean;
  stop: LmStop;
}

/** Central-difference gradient of the model in the parameters, the step scaled to each parameter. */
export function numericGradient<X>(model: Model<X>, x: X, p: readonly number[]): number[] {
  return p.map((pj, j) => {
    const h = 1e-6 * Math.max(Math.abs(pj), 1e-3);
    const up = [...p];
    const down = [...p];
    up[j] = pj + h;
    down[j] = pj - h;
    return (model(x, up) - model(x, down)) / (2 * h);
  });
}

const clamp = (v: number, lo = -Infinity, hi = Infinity): number => Math.min(Math.max(v, lo), hi);

/** JᵀWJ and the gradient JᵀWr of half the weighted sum of squares. */
function normalEquations(jac: readonly (readonly number[])[], w: readonly number[], r: readonly number[]) {
  const k = jac[0]?.length ?? 0;
  const a = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const g = new Array<number>(k).fill(0);
  jac.forEach((row, i) => {
    for (let u = 0; u < k; u += 1) {
      g[u] += w[i] * row[u] * r[i];
      for (let v = 0; v <= u; v += 1) a[u][v] += w[i] * row[u] * row[v];
    }
  });
  for (let u = 0; u < k; u += 1) for (let v = u + 1; v < k; v += 1) a[u][v] = a[v][u];
  return { a, g };
}

function invertSpd(a: Matrix): Matrix {
  const f = cholesky(a);
  // A pivot that lost all but a trillionth of its diagonal means two parameters the data cannot tell apart.
  const lost = f.l.some((row, j) => row[j] * row[j] <= 1e-12 * a[j][j]);
  if (!f.spd || lost) throw new SubjectError('singular', 'JᵀWJ');
  return choleskySolve(f, identity(a.length));
}

/** Fits `model` to the points (xs, ys) from `start`. Throws a SubjectError on bad input or a singular fit. */
export function levenbergMarquardt<X>(
  model: Model<X>,
  xs: readonly X[],
  ys: readonly number[],
  start: readonly number[],
  options: LmOptions<X> = {},
): LmFit {
  const n = xs.length;
  const k = start.length;
  ensure(n > 0 && k > 0, 'empty');
  ensure(ys.length === n, 'shape', 'ys');
  ensure(n >= k, 'tooFew', 'points');
  ensure(ys.every(Number.isFinite) && start.every(Number.isFinite), 'notFinite');
  const w = options.weights ?? new Array<number>(n).fill(1);
  ensure(w.length === n, 'shape', 'weights');
  ensure(
    w.every((v) => Number.isFinite(v) && v >= 0),
    'domain',
    'weights',
  );
  const lo = options.lower ?? [];
  const hi = options.upper ?? [];
  const maxIterations = options.maxIterations ?? 200;
  const tol = options.tolerance ?? 1e-12;
  const grad = options.gradient ?? ((x: X, p: readonly number[]) => numericGradient(model, x, p));

  const project = (p: readonly number[]): number[] => p.map((v, j) => clamp(v, lo[j], hi[j]));
  const residualsAt = (p: readonly number[]): number[] => xs.map((x, i) => model(x, p) - ys[i]);
  const cost = (r: readonly number[]): number => r.reduce((s, ri, i) => s + w[i] * ri * ri, 0);
  const jacobianAt = (p: readonly number[]) => xs.map((x) => grad(x, p));

  let p = project(start);
  let r = residualsAt(p);
  ensure(r.every(Number.isFinite), 'notFinite', 'model');
  let f = cost(r);
  let { a, g } = normalEquations(jacobianAt(p), w, r);
  let mu = 1e-3;
  let nu = 2;
  let stop: LmStop = 'maxIterations';
  let iterations = 0;

  while (iterations < maxIterations) {
    if (Math.max(...g.map(Math.abs)) <= tol * Math.max(1, f)) {
      stop = 'gradient';
      break;
    }
    iterations += 1;
    const diag = a.map((row, j) => Math.max(row[j], 1e-300));
    const damped = a.map((row, u) => row.map((v, c) => (u === c ? v + mu * diag[u] : v)));
    const fac = cholesky(damped);
    if (!fac.spd) {
      mu *= nu;
      nu *= 2;
      continue;
    }
    const step = choleskySolve(
      fac,
      g.map((v) => [-v]),
    ).map((row) => row[0]);
    const trial = project(p.map((v, j) => v + step[j]));
    const h = trial.map((v, j) => v - p[j]);
    if (Math.hypot(...h) <= tol * (Math.hypot(...p) + tol)) {
      stop = 'step';
      break;
    }
    const rTrial = residualsAt(trial);
    const fTrial = cost(rTrial);
    // The linear model's predicted decrease of Σw·r², −2gᵀh − hᵀAh. Without a bound in the way it equals
    // hᵀ(μDh − g), Nielsen's form; written out in full it stays right for a step that a bound has shortened.
    let predicted = 0;
    h.forEach((hu, u) => {
      predicted -= 2 * g[u] * hu;
      h.forEach((hc, c) => (predicted -= hu * a[u][c] * hc));
    });
    const gain = Number.isFinite(fTrial) && predicted > 0 ? (f - fTrial) / predicted : -1;
    if (gain > 0) {
      p = trial;
      r = rTrial;
      f = fTrial;
      ({ a, g } = normalEquations(jacobianAt(p), w, r));
      mu *= Math.max(1 / 3, 1 - (2 * gain - 1) ** 3);
      nu = 2;
    } else {
      mu *= nu;
      nu *= 2;
    }
    if (!Number.isFinite(mu) || mu > 1e300) throw new SubjectError('noConvergence', 'damping');
  }

  const dof = n - k;
  const s2 = dof > 0 ? f / dof : Number.NaN;
  const covariance = invertSpd(a).map((row) => row.map((v) => v * s2));
  return {
    params: p,
    residuals: r.map((v) => -v),
    ssr: f,
    dof,
    s2,
    covariance,
    se: covariance.map((row, j) => Math.sqrt(row[j])),
    iterations,
    converged: stop !== 'maxIterations',
    stop,
  };
}

export interface BandPoint<X> {
  x: X;
  fit: number;
  /** Half-width of the confidence band for the mean response. */
  confidence: number;
  /** Half-width of the prediction band for one new observation of weight `weight`. */
  prediction: number;
}

/** Delta-method bands at each of `at`, from the fit's covariance and a t quantile on its degrees of freedom. */
export function lmBands<X>(
  model: Model<X>,
  fit: LmFit,
  at: readonly X[],
  level = 0.95,
  weight = 1,
  gradient: (x: X, p: readonly number[]) => number[] = (x, p) => numericGradient(model, x, p),
): BandPoint<X>[] {
  ensure(level > 0 && level < 1, 'domain', 'level');
  ensure(fit.dof > 0, 'tooFew', 'dof');
  const t = tQuantile(0.5 + level / 2, fit.dof);
  return at.map((x) => {
    const gx = gradient(x, fit.params);
    let v = 0;
    gx.forEach((gu, u) => gx.forEach((gc, c) => (v += gu * fit.covariance[u][c] * gc)));
    const mean = Math.max(v, 0);
    return {
      x,
      fit: model(x, fit.params),
      confidence: t * Math.sqrt(mean),
      prediction: t * Math.sqrt(mean + fit.s2 / weight),
    };
  });
}
