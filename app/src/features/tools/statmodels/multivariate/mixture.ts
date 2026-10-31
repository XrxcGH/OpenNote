// Gaussian mixtures fitted by expectation-maximization. Each row belongs to every component with some probability
// (the E-step); each component's weight, mean, and covariance are then refitted with those probabilities as weights
// (the M-step). The log-likelihood never falls from one round to the next, and the fit stops when it settles. The
// start is k-means from k-means++ seeds, so a seed gives the same answer every time.
import { cholesky, type Matrix } from '../kit/linalg';
import { fail } from '../kit/types';
import { kMeans, plusPlus } from './cluster';

export interface MixtureParams {
  readonly weights: readonly number[];
  readonly means: Matrix;
  readonly covs: readonly Matrix[];
}

export interface Mixture extends MixtureParams {
  /** resp[i][c]: the chance row i came from component c. */
  readonly resp: Matrix;
  readonly cluster: number[];
  readonly logLik: number;
  /** The log-likelihood after each round, which never falls. */
  readonly history: number[];
  readonly iterations: number;
  readonly params: number;
  readonly aic: number;
  readonly bic: number;
}

const LOG_2PI = Math.log(2 * Math.PI);

/** log N(x | mean, cov) for each row, from the Cholesky factor of the covariance. */
function logDensity(x: Matrix, mean: readonly number[], cov: Matrix): number[] {
  const l = cholesky(cov);
  if (!l) fail('mixtureCollapse');
  const d = mean.length;
  let logDet = 0;
  for (let j = 0; j < d; j++) logDet += 2 * Math.log(l[j][j]);
  return x.map((row) => {
    // Solve L z = x − mean; the squared length of z is the Mahalanobis distance.
    const z = new Array<number>(d);
    let q = 0;
    for (let a = 0; a < d; a++) {
      let s = row[a] - mean[a];
      for (let b = 0; b < a; b++) s -= l[a][b] * z[b];
      z[a] = s / l[a][a];
      q += z[a] * z[a];
    }
    return -0.5 * (d * LOG_2PI + logDet + q);
  });
}

/** The E-step: each row's component probabilities, and the log-likelihood of the parameters. */
export function expectation(x: Matrix, p: MixtureParams): { resp: Matrix; logLik: number } {
  const dens = p.means.map((m, c) => logDensity(x, m, p.covs[c] as Matrix).map((v) => v + Math.log(p.weights[c])));
  let logLik = 0;
  const resp = x.map((_, i) => {
    const each = dens.map((col) => col[i]);
    const top = Math.max(...each);
    const total = top + Math.log(each.reduce((s, v) => s + Math.exp(v - top), 0));
    logLik += total;
    return each.map((v) => Math.exp(v - total));
  });
  return { resp, logLik };
}

/** The M-step: weights, means, and covariances (divided by the weighted count, as maximum likelihood does). */
export function maximization(x: Matrix, resp: Matrix): MixtureParams {
  const n = x.length;
  const d = x[0].length;
  const k = resp[0].length;
  const weights: number[] = [];
  const means: Matrix = [];
  const covs: Matrix[] = [];
  for (let c = 0; c < k; c++) {
    const nk = resp.reduce((s, r) => s + r[c], 0);
    if (!(nk > 1e-8)) fail('mixtureCollapse');
    const mean = Array.from({ length: d }, (_, j) => x.reduce((s, row, i) => s + resp[i][c] * row[j], 0) / nk);
    const cov: Matrix = Array.from({ length: d }, () => new Array<number>(d).fill(0));
    x.forEach((row, i) => {
      for (let a = 0; a < d; a++)
        for (let b = 0; b <= a; b++) cov[a][b] += resp[i][c] * (row[a] - mean[a]) * (row[b] - mean[b]);
    });
    for (let a = 0; a < d; a++) for (let b = 0; b <= a; b++) cov[b][a] = cov[a][b] = cov[a][b] / nk;
    weights.push(nk / n);
    means.push(mean);
    covs.push(cov);
  }
  return { weights, means, covs };
}

/** Free parameters of a k-component mixture with full covariances in d dimensions. */
export const mixtureParams = (k: number, d: number): number => k - 1 + k * d + (k * d * (d + 1)) / 2;

/** Fits k components, from the given start or from k-means seeded by k-means++. */
export function gaussianMixture(
  x: Matrix,
  k: number,
  seed: number,
  options: { start?: MixtureParams; maxIter?: number } = {},
): Mixture {
  const n = x.length;
  if (n === 0 || !x[0]?.length) fail('noData');
  if (!(Number.isInteger(k) && k >= 1 && k < n)) fail('clusterCount', String(n - 1));
  const d = x[0].length;
  let p: MixtureParams;
  if (options.start) p = options.start;
  else {
    // Start at the k-means centers and sizes, each component with the covariance of all the rows, so a small
    // cluster does not start with no spread.
    const km = kMeans(x, plusPlus(x, k, seed));
    const all = maximization(
      x,
      x.map(() => [1]),
    ).covs[0];
    p = { weights: km.sizes.map((s) => (s + 1) / (n + k)), means: km.centers, covs: km.centers.map(() => all) };
  }
  const maxIter = options.maxIter ?? 500;
  const history: number[] = [];
  let e = expectation(x, p);
  history.push(e.logLik);
  let iterations = 0;
  while (iterations < maxIter) {
    p = maximization(x, e.resp);
    e = expectation(x, p);
    iterations++;
    const last = history[history.length - 1];
    history.push(e.logLik);
    if (Math.abs(e.logLik - last) <= 1e-10 * (1 + Math.abs(e.logLik))) break;
  }
  if (!Number.isFinite(e.logLik)) fail('mixtureCollapse');
  const params = mixtureParams(k, d);
  return {
    ...p,
    resp: e.resp,
    cluster: e.resp.map((r) => r.indexOf(Math.max(...r))),
    logLik: e.logLik,
    history,
    iterations,
    params,
    aic: -2 * e.logLik + 2 * params,
    bic: -2 * e.logLik + params * Math.log(n),
  };
}
