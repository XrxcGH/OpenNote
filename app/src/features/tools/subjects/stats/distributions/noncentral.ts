// Noncentral t, chi-square, and F distributions, for power and sample-size work. The t follows Lenth's
// algorithm AS 243 (1989), written from its published series. The chi-square and F are Poisson mixtures of central
// chi-square and beta terms, summed outward from the Poisson mode with an error bound to stop on. Accuracy target:
// 1e-8 absolute.
import { betaInc, gammaP, gammaQ, lgamma } from '../../../kits/num/special';
import { SubjectError, ensure } from '../../errors';
import { normalCdf } from './continuous';
import { continuousQuantile } from './quantile';

const ERR_MAX = 1e-12;
const MAX_TERMS = 10_000;
/** AS 243 loses accuracy once e^(-δ²/2) underflows; beyond this the noncentrality is refused. */
export const MAX_T_NONCENTRALITY = 37.5;

/** P(T ≤ t) for noncentral t with df degrees of freedom and noncentrality δ (Lenth, AS 243). */
export function noncentralTCdf(t: number, df: number, delta: number): number {
  ensure(df > 0 && Number.isFinite(df), 'domain', 'df');
  ensure(Math.abs(delta) <= MAX_T_NONCENTRALITY, 'domain', 'ncp');
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0;
  const negative = t < 0;
  const tt = negative ? -t : t;
  const del = negative ? -delta : delta;
  let tnc = 0;
  const x = (tt * tt) / (tt * tt + df);
  if (x > 0) tnc = lenthSeries(x, df, del);
  tnc += normalCdf(-del);
  return Math.min(1, Math.max(0, negative ? 1 - tnc : tnc));
}

function lenthSeries(x: number, df: number, del: number): number {
  const lambda = del * del;
  let p = 0.5 * Math.exp(-0.5 * lambda);
  let q = Math.sqrt(2 / Math.PI) * p * del;
  let s = 0.5 - p;
  let a = 0.5;
  const b = 0.5 * df;
  const rxb = Math.pow(1 - x, b);
  const lnBeta = lgamma(a) + lgamma(b) - lgamma(a + b);
  let xodd = betaInc(x, a, b);
  let godd = 2 * rxb * Math.exp(a * Math.log(x) - lnBeta);
  let xeven = 1 - rxb;
  let geven = b * x * rxb;
  let tnc = p * xodd + q * xeven;
  for (let n = 1; n <= MAX_TERMS; n += 1) {
    a += 1;
    xodd -= godd;
    xeven -= geven;
    godd *= (x * (a + b - 1)) / a;
    geven *= (x * (a + b - 0.5)) / (a + 0.5);
    p *= lambda / (2 * n);
    q *= lambda / (2 * n + 1);
    s -= p;
    tnc += p * xodd + q * xeven;
    if (2 * s * (xodd - godd) <= ERR_MAX) return tnc;
  }
  throw new SubjectError('noConvergence', 'noncentral t');
}

export const noncentralTSf = (t: number, df: number, delta: number): number => 1 - noncentralTCdf(t, df, delta);

export function noncentralTQuantile(p: number, df: number, delta: number): number {
  const cdf = (x: number) => noncentralTCdf(x, df, delta);
  return continuousQuantile(cdf, (x) => 1 - cdf(x), p, { lo: -Infinity, hi: Infinity }, delta);
}

/**
 * Σ w_j term(j) with Poisson weights w_j = e^(-μ) μ^j / j!. The sum runs down from the mode to 0. Then it runs
 * up until bound(j) × (1 - weight so far) is below ERR_MAX. `term` must lie in [0, 1]; `decreasing` says whether it falls
 * with j (then the upper remainder is at most term(j) times the weight left) or rises (at most the weight left).
 */
function poissonMixture(mu: number, term: (j: number) => number, decreasing: boolean): number {
  if (mu === 0) return term(0);
  const mode = Math.floor(mu);
  const wMode = Math.exp(-mu + mode * Math.log(mu) - lgamma(mode + 1));
  let total = 0;
  let weight = 0;
  for (let j = mode, w = wMode; j >= 0; j -= 1) {
    total += w * term(j);
    weight += w;
    w *= j / mu;
  }
  for (let j = mode + 1, w = (wMode * mu) / (mode + 1); j <= mode + MAX_TERMS; j += 1) {
    const value = term(j);
    total += w * value;
    weight += w;
    const left = Math.max(0, 1 - weight);
    if ((decreasing ? value * left : left) < ERR_MAX && j > mu) return total;
    w *= mu / (j + 1);
  }
  throw new SubjectError('noConvergence', 'Poisson mixture');
}

function checkChi(x: number, df: number, ncp: number): void {
  ensure(df > 0 && Number.isFinite(df), 'domain', 'df');
  ensure(ncp >= 0 && Number.isFinite(ncp), 'domain', 'ncp');
  ensure(!Number.isNaN(x), 'notFinite', 'x');
}

/** P(X ≤ x) for noncentral chi-square with df degrees of freedom and noncentrality λ. */
export function noncentralChiSquareCdf(x: number, df: number, ncp: number): number {
  checkChi(x, df, ncp);
  if (x <= 0) return 0;
  return poissonMixture(ncp / 2, (j) => gammaP(df / 2 + j, x / 2), true);
}

export function noncentralChiSquareSf(x: number, df: number, ncp: number): number {
  checkChi(x, df, ncp);
  if (x <= 0) return 1;
  return poissonMixture(ncp / 2, (j) => gammaQ(df / 2 + j, x / 2), false);
}

export function noncentralChiSquareQuantile(p: number, df: number, ncp: number): number {
  const cdf = (x: number) => noncentralChiSquareCdf(x, df, ncp);
  const sf = (x: number) => noncentralChiSquareSf(x, df, ncp);
  return continuousQuantile(cdf, sf, p, { lo: 0, hi: Infinity }, df + ncp);
}

function checkF(x: number, d1: number, d2: number, ncp: number): void {
  ensure(d1 > 0 && d2 > 0 && Number.isFinite(d1) && Number.isFinite(d2), 'domain', 'df');
  ensure(ncp >= 0 && Number.isFinite(ncp), 'domain', 'ncp');
  ensure(!Number.isNaN(x), 'notFinite', 'x');
}

/** P(F ≤ x) for noncentral F with (d1, d2) degrees of freedom and noncentrality λ. */
export function noncentralFCdf(x: number, d1: number, d2: number, ncp: number): number {
  checkF(x, d1, d2, ncp);
  if (x <= 0) return 0;
  const y = (d1 * x) / (d1 * x + d2);
  return poissonMixture(ncp / 2, (j) => betaInc(y, d1 / 2 + j, d2 / 2), true);
}

export function noncentralFSf(x: number, d1: number, d2: number, ncp: number): number {
  checkF(x, d1, d2, ncp);
  if (x <= 0) return 1;
  const y = d2 / (d2 + d1 * x);
  return poissonMixture(ncp / 2, (j) => betaInc(y, d2 / 2, d1 / 2 + j), false);
}

export function noncentralFQuantile(p: number, d1: number, d2: number, ncp: number): number {
  const cdf = (x: number) => noncentralFCdf(x, d1, d2, ncp);
  const sf = (x: number) => noncentralFSf(x, d1, d2, ncp);
  return continuousQuantile(cdf, sf, p, { lo: 0, hi: Infinity }, 1 + ncp / d1);
}
