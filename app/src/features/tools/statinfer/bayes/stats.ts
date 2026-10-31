// Bayesian updating: conjugate updates (beta-binomial, normal with known variance, normal-inverse-gamma,
// gamma-Poisson, Dirichlet-multinomial) with their summaries and highest-density intervals. It also has Bayes
// factors (Savage-Dickey and JZS), grid posteriors, random-walk Metropolis, and discrete Bayes tables.
import { compileNode, GENERAL, mathConstant, parse, standardFunctions } from '../../../../core/expr';
import { integrate } from '../../kits/num/quad';
import { Rng } from '../../subjects/num/rng';
import {
  betaPdf,
  betaQuantile,
  gammaPdf,
  gammaQuantile,
  normalPdf,
  normalQuantile,
  tPdf,
  tQuantile,
} from '../../subjects/stats/dist';
import { check } from '../report';

export interface Summary {
  readonly mean: number;
  readonly median: number;
  readonly mode: number;
  readonly sd: number;
  readonly lower: number;
  readonly upper: number;
  readonly hdiLower: number;
  readonly hdiUpper: number;
}

/** The shortest interval holding `level` of the probability, for a unimodal distribution with quantile q. */
export function hdi(q: (p: number) => number, level: number): [number, number] {
  let lo = 0;
  let hi = 1 - level;
  const width = (p: number) => q(p + level) - q(p);
  // Golden-section search for the start of the narrowest interval.
  const g = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 100 && hi - lo > 1e-12; i += 1) {
    const a = hi - g * (hi - lo);
    const b = lo + g * (hi - lo);
    if (width(a) < width(b)) hi = b;
    else lo = a;
  }
  const p = (lo + hi) / 2;
  return [q(p), q(p + level)];
}

function summary(q: (p: number) => number, mean: number, mode: number, sd: number, level: number): Summary {
  const alpha = 1 - level;
  const [hdiLower, hdiUpper] = hdi(q, level);
  return { mean, median: q(0.5), mode, sd, lower: q(alpha / 2), upper: q(1 - alpha / 2), hdiLower, hdiUpper };
}

function checkLevel(level: number): void {
  check(level > 0 && level < 1, 'confidenceRange');
}

const positive = (values: readonly number[]) => values.every((v) => Number.isFinite(v) && v > 0);

export interface BetaUpdate {
  readonly a: number;
  readonly b: number;
  readonly summary: Summary;
  readonly predictive: number;
  readonly bf10: number | null;
}

/** Beta(a, b) prior with s successes and f failures: Beta(a + s, b + f); Savage-Dickey BF₁₀ at θ₀ when given. */
export function betaBinomial(
  a: number,
  b: number,
  s: number,
  f: number,
  level = 0.95,
  theta0: number | null = null,
): BetaUpdate {
  check(positive([a, b]), 'priorPositive');
  check(Number.isInteger(s) && Number.isInteger(f) && s >= 0 && f >= 0, 'countsWhole');
  checkLevel(level);
  const pa = a + s;
  const pb = b + f;
  const mean = pa / (pa + pb);
  const mode = pa > 1 && pb > 1 ? (pa - 1) / (pa + pb - 2) : pa <= 1 && pb > 1 ? 0 : pb <= 1 && pa > 1 ? 1 : Number.NaN;
  const sd = Math.sqrt((pa * pb) / ((pa + pb) ** 2 * (pa + pb + 1)));
  let bf10: number | null = null;
  if (theta0 !== null) {
    check(theta0 > 0 && theta0 < 1, 'pointNull');
    bf10 = betaPdf(theta0, a, b) / betaPdf(theta0, pa, pb);
  }
  return {
    a: pa,
    b: pb,
    summary: summary((p) => betaQuantile(p, pa, pb), mean, mode, sd, level),
    predictive: mean,
    bf10,
  };
}

export interface NormalUpdate {
  readonly mean: number;
  readonly variance: number;
  readonly summary: Summary;
  readonly predictiveVariance: number;
}

/** A normal prior N(μ₀, τ₀²) for a mean, with n observations of known SD σ: precisions add. */
export function normalKnown(
  mu0: number,
  tau0: number,
  xbar: number,
  n: number,
  sigma: number,
  level = 0.95,
): NormalUpdate {
  check(positive([tau0, sigma]), 'sdPositive');
  check(Number.isInteger(n) && n >= 1, 'countsWhole');
  checkLevel(level);
  const precision = 1 / tau0 ** 2 + n / sigma ** 2;
  const variance = 1 / precision;
  const mean = variance * (mu0 / tau0 ** 2 + (n * xbar) / sigma ** 2);
  const sd = Math.sqrt(variance);
  return {
    mean,
    variance,
    summary: summary((p) => normalQuantile(p, mean, sd), mean, mean, sd, level),
    predictiveVariance: variance + sigma ** 2,
  };
}

export interface NigUpdate {
  readonly mu: number;
  readonly kappa: number;
  readonly alpha: number;
  readonly beta: number;
  /** The marginal posterior of the mean, a t with 2α degrees of freedom. */
  readonly meanSummary: Summary;
  /** The marginal posterior of the variance, inverse-gamma(α, β). */
  readonly varianceSummary: Summary;
}

/** The normal-inverse-gamma prior (μ₀, κ₀, α₀, β₀) for a normal mean and variance, with n, x̄, and s². */
export function normalInverseGamma(
  mu0: number,
  kappa0: number,
  alpha0: number,
  beta0: number,
  n: number,
  xbar: number,
  s2: number,
  level = 0.95,
): NigUpdate {
  check(positive([kappa0, alpha0, beta0]), 'priorPositive');
  check(Number.isInteger(n) && n >= 1 && s2 >= 0, 'countsWhole');
  checkLevel(level);
  const kappa = kappa0 + n;
  const mu = (kappa0 * mu0 + n * xbar) / kappa;
  const alpha = alpha0 + n / 2;
  const beta = beta0 + 0.5 * (n - 1) * s2 + (kappa0 * n * (xbar - mu0) ** 2) / (2 * kappa);
  const df = 2 * alpha;
  const scale = Math.sqrt(beta / (alpha * kappa));
  const tSd = df > 2 ? scale * Math.sqrt(df / (df - 2)) : Number.NaN;
  const meanSummary = summary((p) => mu + scale * tQuantile(p, df), mu, mu, tSd, level);
  // σ² = 1/precision with precision ~ Gamma(α, rate β).
  const ig = (p: number) => 1 / gammaQuantile(1 - p, alpha, 1 / beta);
  const varianceSummary = summary(
    ig,
    alpha > 1 ? beta / (alpha - 1) : Number.NaN,
    beta / (alpha + 1),
    alpha > 2 ? beta / ((alpha - 1) * Math.sqrt(alpha - 2)) : Number.NaN,
    level,
  );
  return { mu, kappa, alpha, beta, meanSummary, varianceSummary };
}

export interface GammaUpdate {
  readonly shape: number;
  readonly rate: number;
  readonly summary: Summary;
  /** P(next count = k) for k = 0..: negative binomial. */
  readonly predictive: readonly number[];
}

/** Gamma(shape a, rate b) prior for a Poisson rate, with counts summing to Σx over n intervals. */
export function gammaPoisson(a: number, b: number, total: number, n: number, level = 0.95): GammaUpdate {
  check(positive([a, b]), 'priorPositive');
  check(Number.isInteger(total) && total >= 0 && n > 0, 'countsWhole');
  checkLevel(level);
  const shape = a + total;
  const rate = b + n;
  const mean = shape / rate;
  const p = rate / (rate + 1);
  const predictive: number[] = [];
  let term = p ** shape;
  for (let k = 0; k < 60 && (k < 5 || term > 1e-6); k += 1) {
    predictive.push(term);
    term *= ((shape + k) / (k + 1)) * (1 - p);
  }
  return {
    shape,
    rate,
    summary: summary(
      (q) => gammaQuantile(q, shape, 1 / rate),
      mean,
      shape >= 1 ? (shape - 1) / rate : 0,
      Math.sqrt(shape) / rate,
      level,
    ),
    predictive,
  };
}

/** Dirichlet(α) prior with category counts: Dirichlet(α + counts), each share marginally beta. */
export function dirichlet(alpha: readonly number[], counts: readonly number[], level = 0.95) {
  check(alpha.length >= 2 && alpha.length === counts.length, 'dirichletLength');
  check(positive(alpha), 'priorPositive');
  check(
    counts.every((c) => Number.isInteger(c) && c >= 0),
    'countsWhole',
  );
  checkLevel(level);
  const post = alpha.map((a, i) => a + counts[i]);
  const total = post.reduce((s, v) => s + v, 0);
  return post.map((a) => {
    const b = total - a;
    return {
      alpha: a,
      summary: summary(
        (p) => betaQuantile(p, a, b),
        a / total,
        a > 1 && b > 1 ? (a - 1) / (total - 2) : Number.NaN,
        Math.sqrt((a * b) / (total ** 2 * (total + 1))),
        level,
      ),
    };
  });
}

/**
 * The JZS Bayes factor BF₁₀ for a t statistic (Rouder et al. 2009), with a Cauchy prior of scale r on the effect.
 * One sample: N = n, ν = n − 1. Two samples: N = n₁n₂/(n₁ + n₂), ν = n₁ + n₂ − 2.
 */
export function jzs(t: number, n1: number, n2: number | null, r = Math.SQRT1_2): number {
  check(Number.isFinite(t), 'notNumber', { text: 't' });
  check(r > 0, 'scalePositive');
  check(Number.isInteger(n1) && n1 >= 2 && (n2 === null || (Number.isInteger(n2) && n2 >= 2)), 'countsWhole');
  const N = n2 === null ? n1 : (n1 * n2) / (n1 + n2);
  const nu = n2 === null ? n1 - 1 : n1 + n2 - 2;
  const nullLike = (1 + (t * t) / nu) ** (-(nu + 1) / 2);
  // Integrate over u = ln g, so the integrand is smooth and the range is the whole line.
  const integrand = (u: number) => {
    const g = Math.exp(u);
    const a = 1 + N * g * r * r;
    return (
      a ** -0.5 *
      (1 + (t * t) / (a * nu)) ** (-(nu + 1) / 2) *
      (2 * Math.PI) ** -0.5 *
      g ** -0.5 *
      Math.exp(-1 / (2 * g))
    );
  };
  const value = integrate(integrand, -30, 30, { rtol: 1e-10, atol: 1e-14 }).value;
  return value / nullLike;
}

const TABLE = standardFunctions('strict');

/** Compiles typed text with the named parameters, through core/expr; it never runs the text as code. */
export function compileWith(source: string, names: readonly string[]): (values: readonly number[]) => number {
  check(source.trim() !== '', 'expressionEmpty');
  let run: (ctx: readonly number[]) => number;
  try {
    const node = parse(source, GENERAL);
    run = compileNode<readonly number[]>(node, {
      strict: false,
      table: TABLE,
      bind: (name) => {
        const i = names.indexOf(name);
        if (i >= 0) return (ctx) => ctx[i];
        const c = mathConstant(name);
        return c === undefined ? undefined : () => c;
      },
    });
  } catch {
    check(false, 'expression', { text: source.slice(0, 40) });
  }
  // A value outside a function's domain counts as not a number, so a log density can rule out a region.
  return (values) => {
    try {
      return run(values);
    } catch {
      return Number.NaN;
    }
  };
}

export interface Grid {
  readonly xs: readonly number[];
  readonly posterior: readonly number[];
  readonly prior: readonly number[];
  readonly mean: number;
  readonly sd: number;
  readonly mode: number;
  readonly lower: number;
  readonly upper: number;
}

/** A grid posterior for θ from a typed prior and likelihood (each in θ), normalized over [lo, hi]. */
export function gridPosterior(
  prior: string,
  likelihood: string,
  lo: number,
  hi: number,
  points: number,
  level = 0.95,
): Grid {
  check(Number.isFinite(lo) && Number.isFinite(hi) && hi > lo, 'gridRange');
  check(Number.isInteger(points) && points >= 10 && points <= 100_000, 'gridPoints');
  checkLevel(level);
  const p = compileWith(prior, ['theta']);
  const l = compileWith(likelihood, ['theta']);
  const xs = Array.from({ length: points }, (_, i) => lo + ((i + 0.5) * (hi - lo)) / points);
  const pr = xs.map((x) => p([x]));
  const raw = xs.map((x, i) => pr[i] * l([x]));
  check(
    raw.every((v) => Number.isFinite(v) && v >= 0),
    'gridNegative',
  );
  const total = raw.reduce((a, b) => a + b, 0);
  check(total > 0, 'gridZero');
  const post = raw.map((v) => v / total);
  const priorTotal = pr.reduce((a, b) => a + b, 0);
  const mean = xs.reduce((s, x, i) => s + x * post[i], 0);
  const sd = Math.sqrt(xs.reduce((s, x, i) => s + (x - mean) ** 2 * post[i], 0));
  const cdf = (q: number) => {
    let c = 0;
    for (let i = 0; i < xs.length; i += 1) {
      c += post[i];
      if (c >= q) return xs[i];
    }
    return xs[xs.length - 1];
  };
  const step = (hi - lo) / points;
  return {
    xs,
    posterior: post.map((v) => v / step),
    prior: pr.map((v) => (priorTotal > 0 ? v / priorTotal / step : 0)),
    mean,
    sd,
    mode: xs[post.indexOf(Math.max(...post))],
    lower: cdf((1 - level) / 2),
    upper: cdf(1 - (1 - level) / 2),
  };
}

export interface Chain {
  readonly samples: readonly (readonly number[])[];
  readonly acceptance: number;
  readonly means: readonly number[];
  readonly sds: readonly number[];
  readonly autocorrelation: readonly number[];
}

/** Random-walk Metropolis on a typed log density in 1 parameter (theta) or 2 (x, y), seeded. */
export function metropolis(
  logDensity: string,
  names: readonly string[],
  start: readonly number[],
  step: readonly number[],
  iterations: number,
  burn: number,
  seed: bigint,
): Chain {
  check(names.length === start.length && names.length === step.length, 'chainShape');
  check(positive(step), 'stepPositive');
  check(Number.isInteger(iterations) && iterations >= 100 && iterations <= 1_000_000, 'iterationsRange');
  check(Number.isInteger(burn) && burn >= 0 && burn < iterations, 'burnRange');
  const f = compileWith(logDensity, names);
  let current = [...start];
  let logCurrent = f(current);
  check(Number.isFinite(logCurrent), 'startOutside');
  const rng = new Rng(seed);
  const samples: number[][] = [];
  let accepted = 0;
  for (let i = 0; i < iterations; i += 1) {
    const proposal = current.map((v, j) => v + rng.normal(0, step[j]));
    const logProposal = f(proposal);
    if (Number.isFinite(logProposal) && Math.log(rng.uniform()) < logProposal - logCurrent) {
      current = proposal;
      logCurrent = logProposal;
      accepted += 1;
    }
    if (i >= burn) samples.push([...current]);
  }
  const means = names.map((_, j) => samples.reduce((s, x) => s + x[j], 0) / samples.length);
  const sds = names.map((_, j) =>
    Math.sqrt(samples.reduce((s, x) => s + (x[j] - means[j]) ** 2, 0) / (samples.length - 1)),
  );
  const v = sds[0] ** 2;
  const autocorrelation = Array.from({ length: 21 }, (_, lag) => {
    let s = 0;
    for (let i = lag; i < samples.length; i += 1) s += (samples[i][0] - means[0]) * (samples[i - lag][0] - means[0]);
    return v > 0 ? s / (samples.length - 1) / v : Number.NaN;
  });
  return { samples, acceptance: accepted / iterations, means, sds, autocorrelation };
}

/** A discrete Bayes table: posterior ∝ prior × likelihood, with the evidence that normalizes it. */
export function bayesTable(rows: readonly { prior: number; likelihood: number }[]) {
  check(rows.length >= 2, 'twoHypotheses');
  for (const r of rows) {
    check(Number.isFinite(r.prior) && r.prior >= 0, 'priorNonNegative');
    check(Number.isFinite(r.likelihood) && r.likelihood >= 0, 'likelihoodNonNegative');
  }
  const priorTotal = rows.reduce((s, r) => s + r.prior, 0);
  check(priorTotal > 0, 'priorZero');
  const priors = rows.map((r) => r.prior / priorTotal);
  const joint = priors.map((p, i) => p * rows[i].likelihood);
  const evidence = joint.reduce((a, b) => a + b, 0);
  check(evidence > 0, 'evidenceZero');
  return { priors, joint, evidence, posteriors: joint.map((j) => j / evidence) };
}

export const densities = { betaPdf, gammaPdf, normalPdf, tPdf };
