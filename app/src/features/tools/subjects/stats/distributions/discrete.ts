// The discrete distributions: binomial, Poisson, hypergeometric, and negative binomial. Each has its probability
// (pmf), distribution function (cdf, P(X ≤ k)), survival function (sf, P(X > k)), and quantile. Binomial, Poisson,
// and negative binomial tails come from the incomplete beta and gamma functions. Hypergeometric tails are summed in
// log space from the end that is shorter, so Fisher's exact test keeps tiny p-values.
import { betaInc, gammaP, gammaQ, lgamma } from '../../../kits/num/special';
import { ensure } from '../../errors';
import { discreteQuantile } from './quantile';

const isCount = (k: number) => Number.isInteger(k) && k >= 0;
const logChoose = (n: number, k: number) => lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);

function checkBinomial(n: number, p: number): void {
  ensure(isCount(n), 'domain', 'n');
  ensure(p >= 0 && p <= 1, 'domain', 'p');
}

export function binomialPmf(k: number, n: number, p: number): number {
  checkBinomial(n, p);
  if (!Number.isInteger(k) || k < 0 || k > n) return 0;
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;
  return Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log1p(-p));
}

/** P(X ≤ k) = I_{1-p}(n - k, k + 1). */
export function binomialCdf(k: number, n: number, p: number): number {
  checkBinomial(n, p);
  const j = Math.floor(k);
  if (j < 0) return 0;
  if (j >= n) return 1;
  if (p === 0) return 1;
  if (p === 1) return 0;
  return betaInc(1 - p, n - j, j + 1);
}

/** P(X > k) = I_p(k + 1, n - k). */
export function binomialSf(k: number, n: number, p: number): number {
  checkBinomial(n, p);
  const j = Math.floor(k);
  if (j < 0) return 1;
  if (j >= n) return 0;
  if (p === 0) return 0;
  if (p === 1) return 1;
  return betaInc(p, j + 1, n - j);
}

export function binomialQuantile(q: number, n: number, p: number): number {
  checkBinomial(n, p);
  return discreteQuantile((k) => binomialCdf(k, n, p), q, 0, n, n * p);
}

function checkPoisson(mean: number): void {
  ensure(mean >= 0 && Number.isFinite(mean), 'domain', 'mean');
}

export function poissonPmf(k: number, mean: number): number {
  checkPoisson(mean);
  if (!isCount(k)) return 0;
  if (mean === 0) return k === 0 ? 1 : 0;
  return Math.exp(k * Math.log(mean) - mean - lgamma(k + 1));
}

/** P(X ≤ k) = Q(k + 1, mean). */
export function poissonCdf(k: number, mean: number): number {
  checkPoisson(mean);
  const j = Math.floor(k);
  if (j < 0) return 0;
  return mean === 0 ? 1 : gammaQ(j + 1, mean);
}

/** P(X > k) = P(k + 1, mean). */
export function poissonSf(k: number, mean: number): number {
  checkPoisson(mean);
  const j = Math.floor(k);
  if (j < 0) return 1;
  return mean === 0 ? 0 : gammaP(j + 1, mean);
}

export function poissonQuantile(q: number, mean: number): number {
  checkPoisson(mean);
  ensure(q < 1, 'domain', 'p');
  return discreteQuantile((k) => poissonCdf(k, mean), q, 0, Number.MAX_SAFE_INTEGER, mean);
}

/** Draws without replacement: `draws` items from a population of `total` that holds `successes` successes. */
export interface Hypergeometric {
  total: number;
  successes: number;
  draws: number;
}

function hyperSupport({ total, successes, draws }: Hypergeometric): [number, number] {
  ensure(isCount(total) && isCount(successes) && isCount(draws), 'domain', 'counts');
  ensure(successes <= total && draws <= total, 'domain', 'counts');
  return [Math.max(0, draws - (total - successes)), Math.min(draws, successes)];
}

export function hypergeometricLogPmf(k: number, h: Hypergeometric): number {
  const [lo, hi] = hyperSupport(h);
  if (!Number.isInteger(k) || k < lo || k > hi) return -Infinity;
  return logChoose(h.successes, k) + logChoose(h.total - h.successes, h.draws - k) - logChoose(h.total, h.draws);
}

export const hypergeometricPmf = (k: number, h: Hypergeometric): number => Math.exp(hypergeometricLogPmf(k, h));

/** Σ pmf(i) for i from `from` to `to`, by log-sum-exp so tiny terms are not lost. */
function sumPmf(h: Hypergeometric, from: number, to: number): number {
  if (from > to) return 0;
  const logs: number[] = [];
  for (let i = from; i <= to; i += 1) logs.push(hypergeometricLogPmf(i, h));
  const top = Math.max(...logs);
  if (top === -Infinity) return 0;
  return Math.min(1, Math.exp(top) * logs.reduce((s, l) => s + Math.exp(l - top), 0));
}

export function hypergeometricCdf(k: number, h: Hypergeometric): number {
  const [lo, hi] = hyperSupport(h);
  const j = Math.floor(k);
  if (j < lo) return 0;
  if (j >= hi) return 1;
  return j - lo <= hi - j ? sumPmf(h, lo, j) : 1 - sumPmf(h, j + 1, hi);
}

export function hypergeometricSf(k: number, h: Hypergeometric): number {
  const [lo, hi] = hyperSupport(h);
  const j = Math.floor(k);
  if (j < lo) return 1;
  if (j >= hi) return 0;
  return hi - j <= j - lo ? sumPmf(h, j + 1, hi) : 1 - sumPmf(h, lo, j);
}

export function hypergeometricQuantile(q: number, h: Hypergeometric): number {
  const [lo, hi] = hyperSupport(h);
  return discreteQuantile((k) => hypergeometricCdf(k, h), q, lo, hi, (h.draws * h.successes) / Math.max(1, h.total));
}

/** Failures before the r-th success, with success probability p each trial; r may be any positive number. */
function checkNegBinomial(r: number, p: number): void {
  ensure(r > 0 && Number.isFinite(r), 'domain', 'r');
  ensure(p > 0 && p <= 1, 'domain', 'p');
}

export function negativeBinomialPmf(k: number, r: number, p: number): number {
  checkNegBinomial(r, p);
  if (!isCount(k)) return 0;
  if (p === 1) return k === 0 ? 1 : 0;
  const ln = lgamma(k + r) - lgamma(r) - lgamma(k + 1) + r * Math.log(p) + k * Math.log1p(-p);
  return Math.exp(ln);
}

/** P(X ≤ k) = I_p(r, k + 1). */
export function negativeBinomialCdf(k: number, r: number, p: number): number {
  checkNegBinomial(r, p);
  const j = Math.floor(k);
  if (j < 0) return 0;
  return p === 1 ? 1 : betaInc(p, r, j + 1);
}

/** P(X > k) = I_{1-p}(k + 1, r). */
export function negativeBinomialSf(k: number, r: number, p: number): number {
  checkNegBinomial(r, p);
  const j = Math.floor(k);
  if (j < 0) return 1;
  return p === 1 ? 0 : betaInc(1 - p, j + 1, r);
}

export function negativeBinomialQuantile(q: number, r: number, p: number): number {
  checkNegBinomial(r, p);
  ensure(q < 1, 'domain', 'p');
  const mean = (r * (1 - p)) / p;
  return discreteQuantile((k) => negativeBinomialCdf(k, r, p), q, 0, Number.MAX_SAFE_INTEGER, mean);
}
