// Least-squares fits: a straight line with standard errors, and Levenberg-Marquardt for nonlinear models with
// standard errors from the covariance matrix s² (JᵀWJ)⁻¹. Each data row may hold several inputs (substrate and
// inhibitor, for example), and weights 1/SD² apply when replicate spreads are given.
import { LsError } from './errors';
import { invert, solveLinear } from './linalg';
import { tQuantile } from './special';

export interface LineFit {
  slope: number;
  intercept: number;
  seSlope: number;
  seIntercept: number;
  r2: number;
  /** The residual standard deviation. */
  s: number;
  n: number;
}

/** Ordinary least squares y = intercept + slope x. Needs at least 2 points with different x. */
export function lineFit(xs: readonly number[], ys: readonly number[]): LineFit {
  const n = xs.length;
  if (n < 2 || ys.length !== n) throw new LsError('errors.points', { min: 2 });
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0) throw new LsError('errors.sameX');
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const sse = Math.max(0, syy - slope * sxy);
  const s = n > 2 ? Math.sqrt(sse / (n - 2)) : 0;
  return {
    slope,
    intercept,
    seSlope: s / Math.sqrt(sxx),
    seIntercept: s * Math.sqrt(1 / n + (mx * mx) / sxx),
    r2: syy === 0 ? 1 : 1 - sse / syy,
    s,
    n,
  };
}

export type Model = (x: readonly number[], p: readonly number[]) => number;

export interface NonlinearFit {
  params: number[];
  se: number[];
  /** Half-widths of the 95% confidence intervals (t on n - p degrees of freedom). */
  ci95: number[];
  sse: number;
  dof: number;
  iterations: number;
  aic: number;
}

function jacobian(model: Model, xs: readonly (readonly number[])[], p: readonly number[]): number[][] {
  return xs.map((x) =>
    p.map((value, j) => {
      const h = 1e-6 * Math.max(Math.abs(value), 1e-8);
      const up = [...p];
      const down = [...p];
      up[j] = value + h;
      down[j] = value - h;
      return (model(x, up) - model(x, down)) / (2 * h);
    }),
  );
}

function weightedSse(
  model: Model,
  xs: readonly (readonly number[])[],
  ys: readonly number[],
  w: readonly number[],
  p: readonly number[],
) {
  let sum = 0;
  for (let i = 0; i < xs.length; i += 1) sum += w[i] * (ys[i] - model(xs[i], p)) ** 2;
  return sum;
}

/** Levenberg-Marquardt least squares from the starting values p0. Throws errors.converge or errors.points. */
export function levenberg(
  model: Model,
  xs: readonly (readonly number[])[],
  ys: readonly number[],
  p0: readonly number[],
  weights?: readonly number[],
): NonlinearFit {
  const n = xs.length;
  const k = p0.length;
  if (n <= k) throw new LsError('errors.points', { min: k + 1 });
  const w = weights ?? xs.map(() => 1);
  let p = [...p0];
  let sse = weightedSse(model, xs, ys, w, p);
  if (!Number.isFinite(sse)) throw new LsError('errors.start');
  let lambda = 1e-3;
  let iterations = 0;
  for (; iterations < 500; iterations += 1) {
    const J = jacobian(model, xs, p);
    const r = xs.map((x, i) => ys[i] - model(x, p));
    const jtj = p.map((_, a) => p.map((__, b) => J.reduce((s, row, i) => s + w[i] * row[a] * row[b], 0)));
    const jtr = p.map((_, a) => J.reduce((s, row, i) => s + w[i] * row[a] * r[i], 0));
    let improved = false;
    while (lambda < 1e12) {
      const damped = jtj.map((row, a) => row.map((v, b) => (a === b ? v * (1 + lambda) + 1e-300 : v)));
      let step: number[];
      try {
        step = solveLinear(damped, jtr);
      } catch {
        lambda *= 10;
        continue;
      }
      const trialP = p.map((v, j) => v + step[j]);
      const trialSse = weightedSse(model, xs, ys, w, trialP);
      if (Number.isFinite(trialSse) && trialSse <= sse) {
        const relative = (sse - trialSse) / Math.max(sse, 1e-300);
        const small = step.every((s, j) => Math.abs(s) <= 1e-10 * (Math.abs(p[j]) + 1e-10));
        p = trialP;
        sse = trialSse;
        lambda = Math.max(lambda / 10, 1e-12);
        improved = true;
        if (relative < 1e-15 || small) return finish(model, xs, w, p, sse, iterations + 1);
        break;
      }
      lambda *= 10;
    }
    if (!improved) return finish(model, xs, w, p, sse, iterations + 1);
  }
  throw new LsError('errors.converge');
}

function finish(
  model: Model,
  xs: readonly (readonly number[])[],
  w: readonly number[],
  p: number[],
  sse: number,
  iterations: number,
): NonlinearFit {
  const n = xs.length;
  const dof = n - p.length;
  const J = jacobian(model, xs, p);
  const jtj = p.map((_, a) => p.map((__, b) => J.reduce((s, row, i) => s + w[i] * row[a] * row[b], 0)));
  const s2 = dof > 0 ? sse / dof : 0;
  let se = p.map(() => NaN);
  try {
    const cov = invert(jtj);
    se = cov.map((row, i) => Math.sqrt(Math.max(0, row[i] * s2)));
  } catch {
    // A parameter the data cannot pin down keeps an unknown error; the fit is still shown.
  }
  const t = dof > 0 ? tQuantile(0.975, dof) : NaN;
  const aic = n * Math.log(Math.max(sse, 1e-300) / n) + 2 * p.length;
  return { params: p, se, ci95: se.map((e) => e * t), sse, dof, iterations, aic };
}
