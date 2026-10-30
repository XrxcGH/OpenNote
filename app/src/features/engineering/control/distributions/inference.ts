// Inference from samples. Summaries of raw data; confidence intervals for a mean, a proportion, and a variance;
// hypothesis tests (z, t, pooled and Welch two-sample, paired, proportion, variance, and chi-square goodness of fit)
// with p-values and decisions; and the power of a z test. Critical values are computed, not read from tables.

import { ControlError } from '../lib/errors';
import { chi2Cdf, chi2Quantile, normalCdf, normalQuantile } from '../lib/special';
import { step, type Step } from '../lib/steps';
import { fmt, fmtTex } from '../lib/tf';
import { tCdf, tQuantile } from '../lib/special';

export type Alternative = 'two' | 'less' | 'greater';

export interface Summary {
  readonly n: number;
  readonly mean: number;
  readonly sd: number;
}

/** n, mean, and the sample standard deviation (n − 1 in the denominator) of raw data. */
export function summarize(data: readonly number[]): Summary {
  const n = data.length;
  if (n < 2) throw new ControlError('needTwo');
  const mean = data.reduce((s, x) => s + x, 0) / n;
  const ss = data.reduce((s, x) => s + (x - mean) ** 2, 0);
  return { n, mean, sd: Math.sqrt(ss / (n - 1)) };
}

function checkConfidence(conf: number): void {
  if (!(conf > 0 && conf < 1)) throw new ControlError('confidenceRange');
}
function checkN(n: number, min = 2): void {
  if (!Number.isInteger(n) || n < min) throw new ControlError(min === 1 ? 'nWhole' : 'needTwo');
}
function checkSd(sd: number): void {
  if (!(sd > 0) || !Number.isFinite(sd)) throw new ControlError('sdPositive');
}

export interface Interval {
  readonly lower: number;
  readonly upper: number;
  readonly estimate: number;
  readonly critical: number;
  readonly halfWidth: number;
  readonly df?: number;
  readonly steps: readonly Step[];
}

/** A confidence interval for a mean: z with a known σ, otherwise t with n − 1 degrees of freedom. */
export function ciMean(s: Summary & { readonly conf: number; readonly knownSigma?: boolean }): Interval {
  checkConfidence(s.conf);
  checkN(s.n, s.knownSigma ? 1 : 2);
  checkSd(s.sd);
  const alpha = 1 - s.conf;
  const se = s.sd / Math.sqrt(s.n);
  const steps: Step[] = [];
  let critical: number;
  let df: number | undefined;
  if (s.knownSigma) {
    critical = normalQuantile(1 - alpha / 2);
    steps.push(step('ci.zCritical', { conf: fmt(s.conf) }, `z_{${fmtTex(alpha / 2)}} = ${fmtTex(critical)}`));
  } else {
    df = s.n - 1;
    critical = tQuantile(1 - alpha / 2, df);
    steps.push(
      step(
        'ci.tCritical',
        { conf: fmt(s.conf), df: String(df) },
        `t_{${fmtTex(alpha / 2)},\\,${df}} = ${fmtTex(critical)}`,
      ),
    );
  }
  const halfWidth = critical * se;
  steps.push(
    step(
      'ci.standardError',
      {},
      `SE = \\frac{${s.knownSigma ? '\\sigma' : 's'}}{\\sqrt{n}} = \\frac{${fmtTex(s.sd)}}{\\sqrt{${s.n}}}` +
        ` = ${fmtTex(se)}`,
    ),
  );
  steps.push(
    step(
      'ci.meanInterval',
      { lower: fmt(s.mean - halfWidth), upper: fmt(s.mean + halfWidth) },
      `\\bar{x} \\pm ${s.knownSigma ? 'z' : 't'}\\,SE = ${fmtTex(s.mean)} \\pm ${fmtTex(halfWidth)}`,
    ),
  );
  return { lower: s.mean - halfWidth, upper: s.mean + halfWidth, estimate: s.mean, critical, halfWidth, df, steps };
}

/** A confidence interval for a proportion: Wald (p̂ ± z√(p̂q̂/n)) and Wilson's score interval. */
export function ciProportion(
  x: number,
  n: number,
  conf: number,
): Interval & { readonly wilson: readonly [number, number] } {
  checkConfidence(conf);
  checkN(n, 1);
  if (!Number.isInteger(x) || x < 0 || x > n) throw new ControlError('successesRange');
  const p = x / n;
  const z = normalQuantile(1 - (1 - conf) / 2);
  const se = Math.sqrt((p * (1 - p)) / n);
  const halfWidth = z * se;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const wh = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  const steps = [
    step('ci.proportionEstimate', {}, `\\hat{p} = \\frac{x}{n} = \\frac{${x}}{${n}} = ${fmtTex(p)}`),
    step('ci.zCritical', { conf: fmt(conf) }, `z = ${fmtTex(z)}`),
    step('ci.wald', {}, `\\hat{p} \\pm z\\sqrt{\\hat{p}(1-\\hat{p})/n} = ${fmtTex(p)} \\pm ${fmtTex(halfWidth)}`),
    step('ci.wilson', { lower: fmt(centre - wh), upper: fmt(centre + wh) }),
  ];
  if (n * p < 10 || n * (1 - p) < 10) steps.push(step('ci.smallCounts'));
  return {
    lower: p - halfWidth,
    upper: p + halfWidth,
    estimate: p,
    critical: z,
    halfWidth,
    steps,
    wilson: [centre - wh, centre + wh],
  };
}

/** A confidence interval for a variance (and so for σ) from the chi-square distribution. */
export function ciVariance(
  variance: number,
  n: number,
  conf: number,
): Interval & { readonly sdLower: number; readonly sdUpper: number } {
  checkConfidence(conf);
  checkN(n);
  if (!(variance > 0)) throw new ControlError('variancePositive');
  const df = n - 1;
  const alpha = 1 - conf;
  const upperQ = chi2Quantile(1 - alpha / 2, df);
  const lowerQ = chi2Quantile(alpha / 2, df);
  const lower = (df * variance) / upperQ;
  const upper = (df * variance) / lowerQ;
  const steps = [
    step(
      'ci.chiCritical',
      { df: String(df) },
      `\\chi^2_{${fmtTex(alpha / 2)}} = ${fmtTex(lowerQ)},\\quad \\chi^2_{${fmtTex(1 - alpha / 2)}}` +
        ` = ${fmtTex(upperQ)}`,
    ),
    step(
      'ci.varianceInterval',
      { lower: fmt(lower), upper: fmt(upper) },
      `\\left(\\frac{(n-1)s^2}{\\chi^2_{${fmtTex(1 - alpha / 2)}}},\\ \\frac{(n-1)s^2}{\\chi^2_{${fmtTex(alpha / 2)}}}\\right)` +
        ` = (${fmtTex(lower)},\\ ${fmtTex(upper)})`,
    ),
  ];
  return {
    lower,
    upper,
    estimate: variance,
    critical: upperQ,
    halfWidth: Number.NaN,
    df,
    steps,
    sdLower: Math.sqrt(lower),
    sdUpper: Math.sqrt(upper),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Tests

export interface TestResult {
  readonly statistic: number;
  /** 'z', 't', 'chi2' */
  readonly kind: 'z' | 't' | 'chi2';
  readonly df?: number;
  readonly p: number;
  readonly alpha: number;
  readonly reject: boolean;
  readonly critical: number;
  readonly steps: readonly Step[];
  /** A confidence interval for the tested quantity at 1 − α (two-sided), when it applies. */
  readonly interval?: readonly [number, number];
}

function pValue(kind: 'z' | 't', stat: number, alt: Alternative, df = Infinity): number {
  const cdf = (x: number) => (kind === 'z' ? normalCdf(x) : tCdf(x, df));
  if (alt === 'less') return cdf(stat);
  if (alt === 'greater') return 1 - cdf(stat);
  return Math.min(1, 2 * Math.min(cdf(stat), 1 - cdf(stat)));
}

function criticalOf(kind: 'z' | 't', alpha: number, alt: Alternative, df = Infinity): number {
  const q = (p: number) => (kind === 'z' ? normalQuantile(p) : tQuantile(p, df));
  return alt === 'two' ? q(1 - alpha / 2) : alt === 'less' ? q(alpha) : q(1 - alpha);
}

function checkAlpha(alpha: number): void {
  if (!(alpha > 0 && alpha < 1)) throw new ControlError('alphaRange');
}

const altTex: Record<Alternative, string> = { two: '\\ne', less: '<', greater: '>' };

function decide(p: number, alpha: number, steps: Step[]): boolean {
  const reject = p <= alpha;
  steps.push(step(reject ? 'test.reject' : 'test.keep', { p: fmt(p), alpha: fmt(alpha) }));
  return reject;
}

/** One-sample z (σ known) or t test of H₀: μ = μ₀. */
export function testMean(
  s: Summary & {
    readonly mu0: number;
    readonly alt: Alternative;
    readonly alpha: number;
    readonly knownSigma?: boolean;
  },
): TestResult {
  checkAlpha(s.alpha);
  checkN(s.n, s.knownSigma ? 1 : 2);
  checkSd(s.sd);
  const kind = s.knownSigma ? 'z' : 't';
  const df = kind === 't' ? s.n - 1 : undefined;
  const se = s.sd / Math.sqrt(s.n);
  const statistic = (s.mean - s.mu0) / se;
  const steps: Step[] = [
    step('test.hypotheses', {}, `H_0: \\mu = ${fmtTex(s.mu0)},\\quad H_1: \\mu ${altTex[s.alt]} ${fmtTex(s.mu0)}`),
    step(
      kind === 'z' ? 'test.zStatistic' : 'test.tStatistic',
      { df: String(df ?? '') },
      `${kind} = \\frac{\\bar{x} - \\mu_0}{${kind === 'z' ? '\\sigma' : 's'}/\\sqrt{n}}` +
        ` = \\frac{${fmtTex(s.mean)} - ${fmtTex(s.mu0)}}{${fmtTex(s.sd)}/\\sqrt{${s.n}}} = ${fmtTex(statistic)}`,
    ),
  ];
  const p = pValue(kind, statistic, s.alt, df);
  const critical = criticalOf(kind, s.alpha, s.alt, df);
  steps.push(step('test.pValue', { p: fmt(p), critical: fmt(critical) }));
  const reject = decide(p, s.alpha, steps);
  const c2 = criticalOf(kind, s.alpha, 'two', df);
  return {
    statistic,
    kind,
    df,
    p,
    alpha: s.alpha,
    reject,
    critical,
    steps,
    interval: [s.mean - c2 * se, s.mean + c2 * se],
  };
}

/** Two-sample test of H₀: μ₁ − μ₂ = Δ₀, by Welch (unequal variances) or the pooled t test. */
export function testTwoMeans(input: {
  readonly a: Summary;
  readonly b: Summary;
  readonly delta0: number;
  readonly alt: Alternative;
  readonly alpha: number;
  readonly pooled: boolean;
}): TestResult {
  const { a, b, alt, alpha } = input;
  checkAlpha(alpha);
  checkN(a.n);
  checkN(b.n);
  checkSd(a.sd);
  checkSd(b.sd);
  const va = (a.sd * a.sd) / a.n;
  const vb = (b.sd * b.sd) / b.n;
  let se: number;
  let df: number;
  const steps: Step[] = [
    step(
      'test.hypotheses',
      {},
      `H_0: \\mu_1 - \\mu_2` +
        ` = ${fmtTex(input.delta0)},\\quad H_1: \\mu_1 - \\mu_2 ${altTex[alt]} ${fmtTex(input.delta0)}`,
    ),
  ];
  if (input.pooled) {
    df = a.n + b.n - 2;
    const sp2 = ((a.n - 1) * a.sd ** 2 + (b.n - 1) * b.sd ** 2) / df;
    se = Math.sqrt(sp2 * (1 / a.n + 1 / b.n));
    steps.push(
      step(
        'test.pooledVariance',
        {},
        `s_p^2 = \\frac{(n_1-1)s_1^2 + (n_2-1)s_2^2}{n_1+n_2-2} = ${fmtTex(sp2)},\\quad \\nu = ${df}`,
      ),
    );
  } else {
    se = Math.sqrt(va + vb);
    df = (va + vb) ** 2 / (va ** 2 / (a.n - 1) + vb ** 2 / (b.n - 1));
    steps.push(
      step(
        'test.welchDf',
        {},
        `\\nu = \\frac{(s_1^2/n_1 + s_2^2/n_2)^2}{\\frac{(s_1^2/n_1)^2}{n_1-1} + \\frac{(s_2^2/n_2)^2}{n_2-1}}` +
          ` = ${fmtTex(df)}`,
      ),
    );
  }
  const diff = a.mean - b.mean;
  const statistic = (diff - input.delta0) / se;
  steps.push(
    step(
      'test.twoStatistic',
      {},
      `t = \\frac{(\\bar{x}_1 - \\bar{x}_2) - \\Delta_0}{SE}` +
        ` = \\frac{${fmtTex(diff)} - ${fmtTex(input.delta0)}}{${fmtTex(se)}} = ${fmtTex(statistic)}`,
    ),
  );
  const p = pValue('t', statistic, alt, df);
  const critical = criticalOf('t', alpha, alt, df);
  steps.push(step('test.pValue', { p: fmt(p), critical: fmt(critical) }));
  const reject = decide(p, alpha, steps);
  const c2 = criticalOf('t', alpha, 'two', df);
  return { statistic, kind: 't', df, p, alpha, reject, critical, steps, interval: [diff - c2 * se, diff + c2 * se] };
}

/** Paired t test from two equal-length lists: a one-sample t test on the differences. */
export function testPaired(
  first: readonly number[],
  second: readonly number[],
  delta0: number,
  alt: Alternative,
  alpha: number,
): TestResult & { readonly differences: Summary } {
  if (first.length !== second.length) throw new ControlError('pairedLength');
  const differences = summarize(first.map((x, i) => x - second[i]));
  const r = testMean({ ...differences, mu0: delta0, alt, alpha });
  return {
    ...r,
    steps: [
      step('test.paired', { n: String(differences.n), mean: fmt(differences.mean), sd: fmt(differences.sd) }),
      ...r.steps,
    ],
    differences,
  };
}

/** One-proportion z test of H₀: p = p₀. */
export function testProportion(x: number, n: number, p0: number, alt: Alternative, alpha: number): TestResult {
  checkAlpha(alpha);
  checkN(n, 1);
  if (!Number.isInteger(x) || x < 0 || x > n) throw new ControlError('successesRange');
  if (!(p0 > 0 && p0 < 1)) throw new ControlError('probabilityOpen');
  const ph = x / n;
  const se = Math.sqrt((p0 * (1 - p0)) / n);
  const statistic = (ph - p0) / se;
  const steps: Step[] = [
    step('test.hypotheses', {}, `H_0: p = ${fmtTex(p0)},\\quad H_1: p ${altTex[alt]} ${fmtTex(p0)}`),
    step(
      'test.proportionStatistic',
      {},
      `z = \\frac{\\hat{p} - p_0}{\\sqrt{p_0(1-p_0)/n}} = \\frac{${fmtTex(ph)} - ${fmtTex(p0)}}{${fmtTex(se)}}` +
        ` = ${fmtTex(statistic)}`,
    ),
  ];
  const p = pValue('z', statistic, alt);
  const critical = criticalOf('z', alpha, alt);
  steps.push(step('test.pValue', { p: fmt(p), critical: fmt(critical) }));
  if (n * p0 < 10 || n * (1 - p0) < 10) steps.push(step('ci.smallCounts'));
  const reject = decide(p, alpha, steps);
  return { statistic, kind: 'z', p, alpha, reject, critical, steps };
}

/** Chi-square test of H₀: σ² = σ₀². */
export function testVariance(
  variance: number,
  n: number,
  sigma0sq: number,
  alt: Alternative,
  alpha: number,
): TestResult {
  checkAlpha(alpha);
  checkN(n);
  if (!(variance > 0) || !(sigma0sq > 0)) throw new ControlError('variancePositive');
  const df = n - 1;
  const statistic = (df * variance) / sigma0sq;
  const cdf = chi2Cdf(statistic, df);
  const p = alt === 'less' ? cdf : alt === 'greater' ? 1 - cdf : Math.min(1, 2 * Math.min(cdf, 1 - cdf));
  const critical =
    alt === 'less'
      ? chi2Quantile(alpha, df)
      : alt === 'greater'
        ? chi2Quantile(1 - alpha, df)
        : chi2Quantile(1 - alpha / 2, df);
  const steps: Step[] = [
    step(
      'test.hypotheses',
      {},
      `H_0: \\sigma^2 = ${fmtTex(sigma0sq)},\\quad H_1: \\sigma^2 ${altTex[alt]} ${fmtTex(sigma0sq)}`,
    ),
    step('test.chiStatistic', { df: String(df) }, `\\chi^2 = \\frac{(n-1)s^2}{\\sigma_0^2} = ${fmtTex(statistic)}`),
    step('test.pValue', { p: fmt(p), critical: fmt(critical) }),
  ];
  const reject = decide(p, alpha, steps);
  return { statistic, kind: 'chi2', df, p, alpha, reject, critical, steps };
}

/**
 * Chi-square goodness of fit. Expected values may be counts or probabilities (scaled to the total). `estimated`
 * is the number of parameters estimated from the data, which each remove one degree of freedom.
 */
export function goodnessOfFit(
  observed: readonly number[],
  expectedIn: readonly number[],
  alpha: number,
  estimated = 0,
): TestResult & { readonly expected: readonly number[]; readonly contributions: readonly number[] } {
  checkAlpha(alpha);
  if (observed.length < 2) throw new ControlError('gofCategories');
  if (observed.length !== expectedIn.length) throw new ControlError('gofLength');
  if (observed.some((o) => o < 0) || expectedIn.some((e) => !(e > 0))) throw new ControlError('gofValues');
  const total = observed.reduce((s, x) => s + x, 0);
  const eSum = expectedIn.reduce((s, x) => s + x, 0);
  const expected = expectedIn.map((e) => (e * total) / eSum);
  const contributions = observed.map((o, i) => (o - expected[i]) ** 2 / expected[i]);
  const statistic = contributions.reduce((s, x) => s + x, 0);
  const df = observed.length - 1 - estimated;
  if (df < 1) throw new ControlError('gofDf');
  const p = 1 - chi2Cdf(statistic, df);
  const critical = chi2Quantile(1 - alpha, df);
  const steps: Step[] = [
    step('test.gofExpected', { total: fmt(total) }),
    step('test.gofStatistic', { df: String(df) }, `\\chi^2 = \\sum \\frac{(O_i - E_i)^2}{E_i} = ${fmtTex(statistic)}`),
    step('test.pValue', { p: fmt(p), critical: fmt(critical) }),
  ];
  if (expected.some((e) => e < 5)) steps.push(step('test.gofSmall'));
  const reject = decide(p, alpha, steps);
  return { statistic, kind: 'chi2', df, p, alpha, reject, critical, steps, expected, contributions };
}

/** The power of a one-sample z test to detect a true mean μ₁. */
export function powerZ(input: {
  readonly mu0: number;
  readonly mu1: number;
  readonly sigma: number;
  readonly n: number;
  readonly alpha: number;
  readonly alt: Alternative;
}): { readonly power: number; readonly steps: readonly Step[] } {
  checkAlpha(input.alpha);
  checkN(input.n, 1);
  checkSd(input.sigma);
  const shift = ((input.mu1 - input.mu0) * Math.sqrt(input.n)) / input.sigma;
  let power: number;
  if (input.alt === 'greater') power = 1 - normalCdf(normalQuantile(1 - input.alpha) - shift);
  else if (input.alt === 'less') power = normalCdf(normalQuantile(input.alpha) - shift);
  else {
    const z = normalQuantile(1 - input.alpha / 2);
    power = 1 - normalCdf(z - shift) + normalCdf(-z - shift);
  }
  return {
    power,
    steps: [
      step('test.powerShift', {}, `\\delta = \\frac{(\\mu_1 - \\mu_0)\\sqrt{n}}{\\sigma} = ${fmtTex(shift)}`),
      step('test.power', { power: fmt(power) }),
    ],
  };
}
