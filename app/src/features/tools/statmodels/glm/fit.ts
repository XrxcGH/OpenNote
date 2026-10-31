// Generalized linear models by iteratively reweighted least squares: logistic regression for 0/1 outcomes or for
// successes out of trials, and Poisson regression for counts with an optional offset (the log of each row's
// exposure). Each step regresses the working response z = η + (y − μ)/(dμ/dη) on X with weights (dμ/dη)²/Var(μ),
// until the deviance changes by less than 1e-10 of itself. Complete or quasi-complete separation, where a predictor
// splits the 0s from the 1s, is reported instead of returning huge coefficients.
import { lnGamma } from '../kit/dist';
import { leastSquares, matVec, type Matrix } from '../kit/linalg';
import { fail } from '../kit/types';

export type Family = 'logistic' | 'poisson';

export interface GlmData {
  readonly x: Matrix;
  readonly y: readonly number[];
  /** Trials for each row of a grouped logistic model; 1 for each row when left out. */
  readonly trials?: readonly number[];
  readonly offset?: readonly number[];
  readonly columns?: readonly string[];
}

export interface GlmFit {
  readonly coef: number[];
  readonly eta: number[];
  readonly mu: number[];
  /** (X'WX)^-1 at the solution. */
  readonly cov: Matrix;
  readonly deviance: number;
  readonly logLik: number;
  /** The deviance after each iteration. */
  readonly history: number[];
}

const xlogy = (x: number, y: number) => (x === 0 ? 0 : x * Math.log(y));

/** The unit deviance, log likelihood, mean, and weights of each family at η. */
function family(kind: Family, data: GlmData) {
  const m = (i: number) => data.trials?.[i] ?? 1;
  if (kind === 'poisson')
    return {
      mean: (eta: number) => Math.exp(eta),
      weight: (mu: number) => mu,
      dmu: (mu: number) => mu,
      start: (y: number) => Math.log(y + 0.5),
      dev: (y: number, mu: number) => 2 * (xlogy(y, y / mu) - (y - mu)),
      ll: (y: number, mu: number) => xlogy(y, mu) - mu - lnGamma(y + 1),
    };
  return {
    mean: (eta: number, i: number) => m(i) / (1 + Math.exp(-eta)),
    weight: (mu: number, i: number) => mu * (1 - mu / m(i)),
    dmu: (mu: number, i: number) => mu * (1 - mu / m(i)),
    start: (y: number, i: number) => Math.log((y + 0.5) / (m(i) - y + 0.5)),
    dev: (y: number, mu: number, i: number) => 2 * (xlogy(y, y / mu) + xlogy(m(i) - y, (m(i) - y) / (m(i) - mu))),
    ll: (y: number, mu: number, i: number) =>
      lnGamma(m(i) + 1) - lnGamma(y + 1) - lnGamma(m(i) - y + 1) + xlogy(y, mu / m(i)) + xlogy(m(i) - y, 1 - mu / m(i)),
  };
}

/** Checks the outcome against the family: counts for Poisson, 0 to the trials for logistic. */
export function checkOutcome(kind: Family, data: GlmData): void {
  data.y.forEach((y, i) => {
    const m = data.trials?.[i] ?? 1;
    if (!Number.isFinite(y) || y < 0) fail(kind === 'poisson' ? 'countNegative' : 'outcomeRange');
    if (kind === 'logistic') {
      if (!(m > 0) || !Number.isInteger(m)) fail('trialsPositive');
      if (y > m || (data.trials === undefined && y !== 0 && y !== 1)) fail('outcomeRange');
    } else if (!Number.isInteger(y)) fail('countWhole');
  });
}

/** Fits the model by IRLS. */
export function fitGlm(kind: Family, data: GlmData): GlmFit {
  const f = family(kind, data);
  const off = (i: number) => data.offset?.[i] ?? 0;
  let eta = data.y.map((y, i) => f.start(y, i));
  let mu = eta.map((e, i) => f.mean(e, i));
  let coef: number[] = [];
  let cov: Matrix = [];
  let deviance = Infinity;
  const history: number[] = [];
  for (let iter = 0; iter < 100; iter += 1) {
    const w = mu.map((m, i) => Math.max(f.weight(m, i), 1e-300));
    const z = eta.map((e, i) => e - off(i) + (data.y[i] - mu[i]) / Math.max(f.dmu(mu[i], i), 1e-300));
    const root = w.map(Math.sqrt);
    const ls = leastSquares(
      data.x.map((row, i) => row.map((v) => v * root[i])),
      z.map((v, i) => v * root[i]),
      data.columns,
    );
    coef = ls.coef;
    cov = ls.xtxInv;
    eta = matVec(data.x, coef).map((e, i) => e + off(i));
    if (eta.some((e) => !Number.isFinite(e) || (kind === 'poisson' && e > 700))) fail('noConvergence');
    mu = eta.map((e, i) => f.mean(e, i));
    const next = data.y.reduce((s, y, i) => s + f.dev(y, mu[i], i), 0);
    history.push(next);
    const done = Math.abs(next - deviance) < 1e-10 * (Math.abs(next) + 0.1);
    deviance = next;
    // A fitted probability within 1e-13 of 0 or 1 means the predictors split the outcome.
    if (done && kind === 'logistic' && eta.some((e) => Math.abs(e) > 30)) fail('separation');
    if (done) break;
    if (iter === 99) fail(kind === 'logistic' ? 'separation' : 'noConvergence');
  }
  const logLik = data.y.reduce((s, y, i) => s + f.ll(y, mu[i], i), 0);
  return { coef, eta, mu, cov, deviance, logLik, history };
}

/** Pearson's chi-square, Σ (y − μ)² / Var(μ), for the quasi-Poisson dispersion. */
export function pearson(kind: Family, data: GlmData, mu: readonly number[]): number {
  const f = family(kind, data);
  return data.y.reduce((s, y, i) => s + (y - mu[i]) ** 2 / f.weight(mu[i], i), 0);
}

/** The log likelihood at a linear predictor, for the profile likelihood of a model with one column. */
export function logLikAt(kind: Family, data: GlmData, eta: readonly number[]): number {
  const f = family(kind, data);
  return data.y.reduce((s, y, i) => s + f.ll(y, f.mean(eta[i], i), i), 0);
}
