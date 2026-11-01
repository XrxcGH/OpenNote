// Probability distributions: the probability of a region, quantiles, the mean and variance, and the data to draw
// the density with the region shaded, for four discrete and ten continuous distributions. Values come from the
// special functions (computed here, never looked up in a printed table).
import '../text';

import { ControlError } from '../lib/errors';
import { linspace } from '../lib/num';
import {
  betaInc,
  chi2Cdf,
  chi2Quantile,
  fCdf,
  gammaFn,
  gammaP,
  gammaQ,
  invertCdf,
  lnChoose,
  lnGamma,
  normalCdf,
  normalQuantile,
} from '../lib/special';
import { step, type Step } from '../lib/steps';
import { fmt, fmtTex } from '../lib/tf';
import { binomialPmf, tCdf, tPdf, tQuantile } from '../lib/special';

export type DistId =
  | 'binomial'
  | 'poisson'
  | 'geometric'
  | 'hypergeometric'
  | 'normal'
  | 'lognormal'
  | 'exponential'
  | 'gamma'
  | 'weibull'
  | 'uniform'
  | 'beta'
  | 't'
  | 'chi2'
  | 'f';

/** A parameter: its id (a key under kitControl.dist.param), lower bound and whether it must be whole. */
export interface ParamSpec {
  readonly id: string;
  readonly min: number;
  /** True when the bound is exclusive (the value must be strictly greater). */
  readonly open: boolean;
  readonly integer?: boolean;
  readonly max?: number;
  readonly fallback: number;
}

const P = (id: string, min: number, open: boolean, fallback: number, extra: Partial<ParamSpec> = {}): ParamSpec => ({
  id,
  min,
  open,
  fallback,
  ...extra,
});

export const DISTRIBUTIONS: Readonly<
  Record<DistId, { readonly discrete: boolean; readonly params: readonly ParamSpec[] }>
> = {
  binomial: { discrete: true, params: [P('n', 0, false, 10, { integer: true }), P('p', 0, false, 0.3, { max: 1 })] },
  poisson: { discrete: true, params: [P('lambda', 0, true, 3)] },
  geometric: { discrete: true, params: [P('p', 0, true, 0.2, { max: 1 })] },
  hypergeometric: {
    discrete: true,
    params: [
      P('population', 1, false, 50, { integer: true }),
      P('successes', 0, false, 10, { integer: true }),
      P('draws', 0, false, 5, { integer: true }),
    ],
  },
  normal: { discrete: false, params: [P('mean', -Infinity, false, 0), P('sd', 0, true, 1)] },
  lognormal: { discrete: false, params: [P('logMean', -Infinity, false, 0), P('logSd', 0, true, 1)] },
  exponential: { discrete: false, params: [P('rate', 0, true, 1)] },
  gamma: { discrete: false, params: [P('shape', 0, true, 2), P('scale', 0, true, 1)] },
  weibull: { discrete: false, params: [P('shape', 0, true, 2), P('scale', 0, true, 1)] },
  uniform: { discrete: false, params: [P('lower', -Infinity, false, 0), P('upper', -Infinity, false, 1)] },
  beta: { discrete: false, params: [P('alpha', 0, true, 2), P('beta', 0, true, 5)] },
  t: { discrete: false, params: [P('df', 0, true, 10)] },
  chi2: { discrete: false, params: [P('df', 0, true, 5)] },
  f: { discrete: false, params: [P('df1', 0, true, 5), P('df2', 0, true, 10)] },
};

export interface Dist {
  readonly id: DistId;
  readonly discrete: boolean;
  readonly lo: number;
  readonly hi: number;
  readonly pdf: (x: number) => number;
  readonly cdf: (x: number) => number;
  readonly quantile: (p: number) => number;
  readonly mean: number;
  readonly variance: number;
  /** The distribution written out, for example "Bin(10, 0.3)". */
  readonly label: string;
}

/** Checks the parameters against their bounds and builds the distribution. */
/** Each distribution from its parameters, in the order of DISTRIBUTIONS. */
const BUILDERS: Readonly<Record<DistId, (a: number, b: number, c: number) => Dist>> = {
  binomial: (a, b) => {
    const n = a;
    const p = b;
    const cdf = (x: number) => {
      const k = Math.floor(x + 1e-9);
      if (k < 0) return 0;
      if (k >= n) return 1;
      if (p === 0) return 1;
      if (p === 1) return 0;
      return betaInc(1 - p, n - k, k + 1);
    };
    return discrete(
      'binomial',
      0,
      n,
      (k) => binomialPmf(k, n, p),
      cdf,
      n * p,
      n * p * (1 - p),
      `Bin(${fmt(n)}, ${fmt(p)})`,
    );
  },
  poisson: (a) => {
    const lam = a;
    const pmf = (k: number) => (k < 0 ? 0 : Math.exp(k * Math.log(lam) - lam - lnGamma(k + 1)));
    const cdf = (x: number) => {
      const k = Math.floor(x + 1e-9);
      return k < 0 ? 0 : gammaQ(k + 1, lam);
    };
    return discrete('poisson', 0, Infinity, pmf, cdf, lam, lam, `Poisson(${fmt(lam)})`);
  },
  geometric: (a) => {
    const p = a;
    const pmf = (k: number) => (k < 1 ? 0 : p * (1 - p) ** (k - 1));
    const cdf = (x: number) => {
      const k = Math.floor(x + 1e-9);
      return k < 1 ? 0 : 1 - (1 - p) ** k;
    };
    return discrete('geometric', 1, Infinity, pmf, cdf, 1 / p, (1 - p) / (p * p), `Geo(${fmt(p)})`);
  },
  hypergeometric: (a, b, c) => {
    const N = a;
    const K = b;
    const n = c;
    if (K > N) throw new ControlError('hyperSuccesses');
    if (n > N) throw new ControlError('hyperDraws');
    const lo = Math.max(0, n - (N - K));
    const hi = Math.min(n, K);
    const pmf = (k: number) =>
      k < lo || k > hi ? 0 : Math.exp(lnChoose(K, k) + lnChoose(N - K, n - k) - lnChoose(N, n));
    const cdf = (x: number) => {
      let s = 0;
      for (let k = lo; k <= Math.min(hi, Math.floor(x + 1e-9)); k += 1) s += pmf(k);
      return Math.min(1, s);
    };
    const mean = (n * K) / N;
    const variance = N > 1 ? (mean * (1 - K / N) * (N - n)) / (N - 1) : 0;
    return discrete('hypergeometric', lo, hi, pmf, cdf, mean, variance, `Hypergeometric(${N}, ${K}, ${n})`);
  },
  normal: (a, b) => {
    return continuous(
      'normal',
      -Infinity,
      Infinity,
      (x) => Math.exp(-0.5 * ((x - a) / b) ** 2) / (b * Math.sqrt(2 * Math.PI)),
      (x) => normalCdf(x, a, b),
      (p) => a + b * normalQuantile(p),
      a,
      b * b,
      `N(${fmt(a)}, ${fmt(b)}²)`,
    );
  },
  lognormal: (a, b) => {
    return continuous(
      'lognormal',
      0,
      Infinity,
      (x) => (x <= 0 ? 0 : Math.exp(-0.5 * ((Math.log(x) - a) / b) ** 2) / (x * b * Math.sqrt(2 * Math.PI))),
      (x) => (x <= 0 ? 0 : normalCdf(Math.log(x), a, b)),
      (p) => Math.exp(a + b * normalQuantile(p)),
      Math.exp(a + (b * b) / 2),
      (Math.exp(b * b) - 1) * Math.exp(2 * a + b * b),
      `LogN(${fmt(a)}, ${fmt(b)}²)`,
    );
  },
  exponential: (a) => {
    return continuous(
      'exponential',
      0,
      Infinity,
      (x) => (x < 0 ? 0 : a * Math.exp(-a * x)),
      (x) => (x <= 0 ? 0 : -Math.expm1(-a * x)),
      (p) => -Math.log1p(-p) / a,
      1 / a,
      1 / (a * a),
      `Exp(${fmt(a)})`,
    );
  },
  gamma: (a, b) => {
    return continuous(
      'gamma',
      0,
      Infinity,
      (x) =>
        x <= 0
          ? x === 0 && a === 1
            ? 1 / b
            : 0
          : Math.exp((a - 1) * Math.log(x) - x / b - lnGamma(a) - a * Math.log(b)),
      (x) => (x <= 0 ? 0 : gammaP(a, x / b)),
      (p) => invertCdf((x) => gammaP(a, x / b), p, a * b, 0, Infinity),
      a * b,
      a * b * b,
      `Gamma(${fmt(a)}, ${fmt(b)})`,
    );
  },
  weibull: (a, b) => {
    return continuous(
      'weibull',
      0,
      Infinity,
      (x) => (x < 0 ? 0 : (a / b) * (x / b) ** (a - 1) * Math.exp(-((x / b) ** a))),
      (x) => (x <= 0 ? 0 : -Math.expm1(-((x / b) ** a))),
      (p) => b * (-Math.log1p(-p)) ** (1 / a),
      b * gammaFn(1 + 1 / a),
      b * b * (gammaFn(1 + 2 / a) - gammaFn(1 + 1 / a) ** 2),
      `Weibull(${fmt(a)}, ${fmt(b)})`,
    );
  },
  uniform: (a, b) => {
    if (!(b > a)) throw new ControlError('uniformOrder');
    return continuous(
      'uniform',
      a,
      b,
      (x) => (x < a || x > b ? 0 : 1 / (b - a)),
      (x) => Math.min(1, Math.max(0, (x - a) / (b - a))),
      (p) => a + p * (b - a),
      (a + b) / 2,
      (b - a) ** 2 / 12,
      `U(${fmt(a)}, ${fmt(b)})`,
    );
  },
  beta: (a, b) => {
    return continuous(
      'beta',
      0,
      1,
      (x) =>
        x < 0 || x > 1
          ? 0
          : Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - (lnGamma(a) + lnGamma(b) - lnGamma(a + b))),
      (x) => betaInc(Math.min(1, Math.max(0, x)), a, b),
      (p) => invertCdf((x) => betaInc(x, a, b), p, a / (a + b), 0, 1),
      a / (a + b),
      (a * b) / ((a + b) ** 2 * (a + b + 1)),
      `Beta(${fmt(a)}, ${fmt(b)})`,
    );
  },
  t: (a) => {
    return continuous(
      't',
      -Infinity,
      Infinity,
      (x) => tPdf(x, a),
      (x) => tCdf(x, a),
      (p) => tQuantile(p, a),
      a > 1 ? 0 : Number.NaN,
      a > 2 ? a / (a - 2) : a > 1 ? Infinity : Number.NaN,
      `t(${fmt(a)})`,
    );
  },
  chi2: (a) => {
    return continuous(
      'chi2',
      0,
      Infinity,
      (x) => (x <= 0 ? 0 : Math.exp((a / 2 - 1) * Math.log(x) - x / 2 - (a / 2) * Math.LN2 - lnGamma(a / 2))),
      (x) => chi2Cdf(x, a),
      (p) => chi2Quantile(p, a),
      a,
      2 * a,
      `χ²(${fmt(a)})`,
    );
  },
  f: (a, b) => {
    return continuous(
      'f',
      0,
      Infinity,
      (x) =>
        x <= 0
          ? 0
          : Math.exp(
              0.5 * (a * Math.log(a * x) + b * Math.log(b) - (a + b) * Math.log(a * x + b)) -
                Math.log(x) -
                (lnGamma(a / 2) + lnGamma(b / 2) - lnGamma((a + b) / 2)),
            ),
      (x) => fCdf(x, a, b),
      (p) => invertCdf((x) => fCdf(x, a, b), p, 1, 0, Infinity),
      // The mean diverges for d2 ≤ 2; the variance diverges for 2 < d2 ≤ 4 and is undefined below that.
      b > 2 ? b / (b - 2) : Infinity,
      b > 4 ? (2 * b * b * (a + b - 2)) / (a * (b - 2) ** 2 * (b - 4)) : b > 2 ? Infinity : Number.NaN,
      `F(${fmt(a)}, ${fmt(b)})`,
    );
  },
};

export function makeDist(id: DistId, params: readonly number[]): Dist {
  const spec = Object.hasOwn(DISTRIBUTIONS, id) ? DISTRIBUTIONS[id] : undefined;
  if (!spec) throw new ControlError('unknownDistribution');
  spec.params.forEach((ps, i) => {
    const v = params[i];
    if (!Number.isFinite(v)) throw new ControlError('paramNumber', { name: ps.id });
    if (ps.integer && !Number.isInteger(v)) throw new ControlError('paramWhole', { name: ps.id });
    if (ps.open ? !(v > ps.min) : !(v >= ps.min))
      throw new ControlError(ps.open ? 'paramPositive' : 'paramMin', { name: ps.id, min: fmt(ps.min) });
    if (ps.max !== undefined && v > ps.max) throw new ControlError('paramMax', { name: ps.id, max: fmt(ps.max) });
  });
  return BUILDERS[id](params[0], params[1], params[2]);
}

function discrete(
  id: DistId,
  lo: number,
  hi: number,
  pmf: (k: number) => number,
  cdf: (x: number) => number,
  mean: number,
  variance: number,
  label: string,
): Dist {
  const quantile = (p: number) => {
    if (p <= 0) return lo;
    // Smallest k with P(X ≤ k) ≥ p: step up from a normal-approximation start.
    let k = Math.max(lo, Math.floor(mean + Math.sqrt(variance) * normalQuantile(Math.min(p, 1 - 1e-12))) - 3);
    while (k > lo && cdf(k - 1) >= p - 1e-12) k -= 1;
    while (k < hi && cdf(k) < p - 1e-12) k += 1;
    return k;
  };
  return {
    id,
    discrete: true,
    lo,
    hi,
    pdf: (k) => (Number.isInteger(k) ? pmf(k) : 0),
    cdf,
    quantile,
    mean,
    variance,
    label,
  };
}

function continuous(
  id: DistId,
  lo: number,
  hi: number,
  pdf: (x: number) => number,
  cdf: (x: number) => number,
  quantile: (p: number) => number,
  mean: number,
  variance: number,
  label: string,
): Dist {
  return { id, discrete: false, lo, hi, pdf, cdf, quantile, mean, variance, label };
}

// ---------------------------------------------------------------------------------------------------------------
// Regions

export type RegionKind = 'le' | 'lt' | 'ge' | 'gt' | 'eq' | 'between' | 'outside';

export interface Region {
  readonly kind: RegionKind;
  readonly a: number;
  /** The upper end for 'between' and 'outside'. */
  readonly b?: number;
}

export interface PlotData {
  /** Continuous: the density on a grid; discrete: one bar per k. */
  readonly xs: readonly number[];
  readonly ys: readonly number[];
  /** For each x, whether it lies in the region. */
  readonly inside: readonly boolean[];
}

export interface ProbabilityResult {
  readonly p: number;
  readonly mean: number;
  readonly variance: number;
  readonly label: string;
  readonly steps: readonly Step[];
  readonly plot: PlotData;
}

const symbol: Record<RegionKind, string> = {
  le: '\\le',
  lt: '<',
  ge: '\\ge',
  gt: '>',
  eq: '=',
  between: '',
  outside: '',
};

/** P(X in region), with steps and plot data. */
export function probability(dist: Dist, region: Region): ProbabilityResult {
  const { a } = region;
  const b = region.b ?? a;
  if (!Number.isFinite(a) || ((region.kind === 'between' || region.kind === 'outside') && !Number.isFinite(b)))
    throw new ControlError('regionNumber');
  if ((region.kind === 'between' || region.kind === 'outside') && b < a) throw new ControlError('regionOrder');
  if (region.kind === 'eq' && !dist.discrete) throw new ControlError('pointContinuous');
  const below = (x: number, strict: boolean) =>
    dist.discrete && strict ? dist.cdf(Math.ceil(x) - 1) : dist.discrete ? dist.cdf(Math.floor(x + 1e-9)) : dist.cdf(x);
  let p: number;
  switch (region.kind) {
    case 'le':
      p = below(a, false);
      break;
    case 'lt':
      p = below(a, true);
      break;
    case 'ge':
      p = 1 - below(a, true);
      break;
    case 'gt':
      p = 1 - below(a, false);
      break;
    case 'eq':
      p = dist.pdf(a);
      break;
    case 'between':
      p = below(b, false) - below(a, true);
      break;
    case 'outside':
      p = below(a, true) + 1 - below(b, false);
      break;
  }
  p = Math.min(1, Math.max(0, p));
  const steps: Step[] = [];
  const event =
    region.kind === 'between'
      ? `${fmtTex(a)} \\le X \\le ${fmtTex(b)}`
      : region.kind === 'outside'
        ? `X < ${fmtTex(a)} \\text{ or } X > ${fmtTex(b)}`
        : `X ${symbol[region.kind]} ${fmtTex(a)}`;
  steps.push(step('dist.model', { label: dist.label, mean: fmt(dist.mean), variance: fmt(dist.variance) }));
  if (dist.id === 'normal') {
    const sd = Math.sqrt(dist.variance);
    const z = (x: number) => (x - dist.mean) / sd;
    steps.push(
      step(
        'dist.standardize',
        {},
        `z = \\frac{x - \\mu}{\\sigma} = \\frac{${fmtTex(a)} - ${fmtTex(dist.mean)}}{${fmtTex(sd)}} = ${fmtTex(z(a))}`,
      ),
    );
    if (region.kind === 'between' || region.kind === 'outside')
      steps.push(step('dist.standardizeUpper', {}, `z_2 = ${fmtTex(z(b))}`));
    steps.push(step('dist.phi', {}, `\\Phi(${fmtTex(z(a))}) = ${fmtTex(normalCdf(z(a)))}`));
  } else if (dist.discrete && region.kind === 'eq') steps.push(step(`dist.pmf.${dist.id}`, { k: fmt(a) }));
  else if (dist.discrete) steps.push(step('dist.sumPmf'));
  else steps.push(step('dist.integrate'));
  steps.push(step('dist.result', { p: fmt(p) }, `P(${event}) = ${fmtTex(p)}`));
  return {
    p,
    mean: dist.mean,
    variance: dist.variance,
    label: dist.label,
    steps,
    plot: plotData(dist, (x) => inRegion(region, x, b)),
  };
}

function inRegion(r: Region, x: number, b: number): boolean {
  switch (r.kind) {
    case 'le':
      return x <= r.a + 1e-12;
    case 'lt':
      return x < r.a - 1e-12;
    case 'ge':
      return x >= r.a - 1e-12;
    case 'gt':
      return x > r.a + 1e-12;
    case 'eq':
      return Math.abs(x - r.a) < 1e-9;
    case 'between':
      return x >= r.a - 1e-12 && x <= b + 1e-12;
    case 'outside':
      return x < r.a - 1e-12 || x > b + 1e-12;
  }
}

/** The points to draw: bars for a discrete distribution, a 241-point curve for a continuous one. */
export function plotData(dist: Dist, inside: (x: number) => boolean = () => false): PlotData {
  if (dist.discrete) {
    const lo = Math.max(dist.lo, Math.min(dist.quantile(0.0005), Math.floor(dist.mean - 4 * Math.sqrt(dist.variance))));
    const hi = Math.min(dist.hi, Math.max(dist.quantile(0.9995), lo + 1), lo + 400);
    const xs: number[] = [];
    for (let k = lo; k <= hi; k += 1) xs.push(k);
    return { xs, ys: xs.map(dist.pdf), inside: xs.map(inside) };
  }
  const left = Number.isFinite(dist.lo) ? dist.lo : dist.quantile(0.001);
  const right = Number.isFinite(dist.hi) ? dist.hi : dist.quantile(0.999);
  const xs = linspace(left, right, 241);
  const cap = (y: number) => (Number.isFinite(y) ? y : 0);
  return { xs, ys: xs.map((x) => cap(dist.pdf(x))), inside: xs.map(inside) };
}

export interface QuantileResult {
  readonly x: number;
  readonly steps: readonly Step[];
}

/** The value with probability p at or below it (for a discrete distribution, the smallest such k). */
export function quantileOf(dist: Dist, p: number): QuantileResult {
  if (!(p > 0 && p < 1)) throw new ControlError('probabilityOpen');
  const x = dist.quantile(p);
  return {
    x,
    steps: [
      step('dist.model', { label: dist.label, mean: fmt(dist.mean), variance: fmt(dist.variance) }),
      step(
        dist.discrete ? 'dist.quantileDiscrete' : 'dist.quantile',
        { p: fmt(p), x: fmt(x) },
        `F(${fmtTex(x)}) ${dist.discrete ? '\\ge' : '='} ${fmtTex(p)}`,
      ),
    ],
  };
}

export { chi2Quantile, normalQuantile, tQuantile };
