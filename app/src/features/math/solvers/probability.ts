// Probability tools: the normal, binomial, and Student t distributions with the area of a region and the data to
// shade it, the quantile (inverse) functions, and simple linear regression with R². The special functions (erf,
// log gamma, the regularized incomplete beta) are written out here to about 1e-14.
import { SolverError, numberText } from './expr';
import { step, type Step, type XY } from './steps';

// ---------------------------------------------------------------------------------------------------------------
// Special functions

/** erfc by its Taylor series near 0 and a continued fraction beyond. */
export function erfc(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (Math.abs(x) < 2.5) {
    let term = x;
    let sum = x;
    for (let n = 1; n < 200; n += 1) {
      term *= (-x * x) / n;
      const add = term / (2 * n + 1);
      sum += add;
      if (Math.abs(add) < 1e-17 * Math.abs(sum)) break;
    }
    return 1 - (2 / Math.sqrt(Math.PI)) * sum;
  }
  if (x < 0) return 2 - erfc(-x);
  // erfc x = e^(-x²)/√π · 1/(x + (1/2)/(x + 1/(x + (3/2)/(x + …)))), evaluated from the tail.
  let f = x;
  for (let n = 80; n >= 1; n -= 1) f = x + n / 2 / f;
  return Math.exp(-x * x) / Math.sqrt(Math.PI) / f;
}

export const erf = (x: number): number => 1 - erfc(x);

/** ln Γ(x) for x > 0, by the Lanczos approximation (g = 7). */
export function lnGamma(x: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lnGamma(1 - x);
  const z = x - 1;
  let a = c[0];
  const t = z + 7.5;
  for (let i = 1; i < 9; i += 1) a += c[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** The regularized incomplete beta I_x(a, b), by the continued fraction of Numerical Recipes. */
export function betaInc(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x > (a + 1) / (a + b + 2)) return 1 - betaInc(1 - x, b, a);
  const tiny = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  d = 1 / (Math.abs(d) < tiny ? tiny : d);
  let h = d;
  for (let m = 1; m <= 300; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    d = 1 / (Math.abs(d) < tiny ? tiny : d);
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    d = 1 / (Math.abs(d) < tiny ? tiny : d);
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return (front * h) / a;
}

// ---------------------------------------------------------------------------------------------------------------
// Distributions

export type Distribution =
  | { readonly kind: 'normal'; readonly mean: number; readonly sd: number }
  | { readonly kind: 'binomial'; readonly n: number; readonly p: number }
  | { readonly kind: 't'; readonly df: number };

export type Region =
  | { readonly kind: 'below'; readonly b: number }
  | { readonly kind: 'above'; readonly a: number }
  | { readonly kind: 'between'; readonly a: number; readonly b: number }
  | { readonly kind: 'outside'; readonly a: number; readonly b: number };

export const normalPdf = (x: number, mean = 0, sd = 1): number =>
  Math.exp(-0.5 * ((x - mean) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI));
export const normalCdf = (x: number, mean = 0, sd = 1): number => 0.5 * erfc(-(x - mean) / (sd * Math.SQRT2));

export function tPdf(t: number, df: number): number {
  const ln =
    lnGamma((df + 1) / 2) -
    lnGamma(df / 2) -
    0.5 * Math.log(df * Math.PI) -
    ((df + 1) / 2) * Math.log(1 + (t * t) / df);
  return Math.exp(ln);
}

export function tCdf(t: number, df: number): number {
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0;
  const tail = 0.5 * betaInc(df / (df + t * t), df / 2, 0.5);
  return t > 0 ? 1 - tail : tail;
}

export function binomialPmf(k: number, n: number, p: number): number {
  if (k < 0 || k > n || !Number.isInteger(k)) return 0;
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;
  return Math.exp(lnGamma(n + 1) - lnGamma(k + 1) - lnGamma(n - k + 1) + k * Math.log(p) + (n - k) * Math.log(1 - p));
}

export function binomialCdf(k: number, n: number, p: number): number {
  let sum = 0;
  for (let i = 0; i <= Math.min(n, Math.floor(k)); i += 1) sum += binomialPmf(i, n, p);
  return Math.min(1, sum);
}

/** The standard normal quantile, by Acklam's rational approximation and one Halley step. */
export function normalQuantile(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239,
  ];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968,
    2.938163982698783,
  ];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  let x: number;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    x =
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - low) {
    const q = p - 0.5;
    const r = q * q;
    x =
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x =
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const e = normalCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

/** The t quantile, by Newton's method from the normal one. */
export function tQuantile(p: number, df: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  let x = normalQuantile(p);
  for (let i = 0; i < 60; i += 1) {
    const step = (tCdf(x, df) - p) / tPdf(x, df);
    x -= Math.max(-2, Math.min(2, step));
    if (Math.abs(step) < 1e-14 * Math.max(1, Math.abs(x))) break;
  }
  return x;
}

/** The value with probability p below it. For the binomial, the smallest k with P(X ≤ k) ≥ p. */
export function quantile(dist: Distribution, p: number): number {
  if (dist.kind === 'normal') return dist.mean + dist.sd * normalQuantile(p);
  if (dist.kind === 't') return tQuantile(p, dist.df);
  let sum = 0;
  for (let k = 0; k <= dist.n; k += 1) {
    sum += binomialPmf(k, dist.n, dist.p);
    if (sum >= p - 1e-12) return k;
  }
  return dist.n;
}

export interface Bar {
  readonly k: number;
  readonly p: number;
  readonly shaded: boolean;
}

export interface ProbabilityResult {
  readonly probability: number;
  readonly mean: number;
  readonly variance: number;
  readonly steps: readonly Step[];
  /** The density curve for a continuous distribution. */
  readonly curve: readonly XY[];
  /** The shaded areas under it, each a closed outline. */
  readonly shaded: readonly (readonly XY[])[];
  /** The bars of a binomial distribution. */
  readonly bars: readonly Bar[];
}

function check(dist: Distribution): void {
  const bad =
    (dist.kind === 'normal' && !(dist.sd > 0 && Number.isFinite(dist.mean))) ||
    (dist.kind === 'binomial' &&
      !(Number.isInteger(dist.n) && dist.n >= 0 && dist.n <= 10_000 && dist.p >= 0 && dist.p <= 1)) ||
    (dist.kind === 't' && !(dist.df > 0));
  if (bad) throw new SolverError('prob-parameters');
}

const within = (region: Region, x: number): boolean =>
  region.kind === 'below'
    ? x <= region.b
    : region.kind === 'above'
      ? x >= region.a
      : region.kind === 'between'
        ? x >= region.a && x <= region.b
        : x < region.a || x > region.b;

/** The probability of a region and the data to draw it. */
export function probability(dist: Distribution, region: Region): ProbabilityResult {
  check(dist);
  if ((region.kind === 'between' || region.kind === 'outside') && region.a > region.b)
    throw new SolverError('prob-region');
  const steps: Step[] = [];
  if (dist.kind === 'binomial') {
    const { n, p } = dist;
    const bars = Array.from({ length: n + 1 }, (_, k) => ({ k, p: binomialPmf(k, n, p), shaded: false })).map(
      (bar) => ({
        ...bar,
        shaded: within(region, bar.k),
      }),
    );
    const probability = bars.filter((bar) => bar.shaded).reduce((sum, bar) => sum + bar.p, 0);
    steps.push(step('probBinomial', `P(X = k) = C(${n}, k)·${numberText(p)}^k·${numberText(1 - p)}^(${n} − k)`));
    steps.push(step('probSum', `P = ${numberText(Math.min(1, probability), 8)}`));
    steps.push(step('probMoments', `μ = np = ${numberText(n * p)},  σ² = np(1 − p) = ${numberText(n * p * (1 - p))}`));
    return {
      probability: Math.min(1, probability),
      mean: n * p,
      variance: n * p * (1 - p),
      steps,
      curve: [],
      shaded: [],
      bars,
    };
  }
  const [pdf, cdf, mean, variance, lo, hi] =
    dist.kind === 'normal'
      ? [
          (x: number) => normalPdf(x, dist.mean, dist.sd),
          (x: number) => normalCdf(x, dist.mean, dist.sd),
          dist.mean,
          dist.sd ** 2,
          dist.mean - 4 * dist.sd,
          dist.mean + 4 * dist.sd,
        ]
      : [
          (x: number) => tPdf(x, dist.df),
          (x: number) => tCdf(x, dist.df),
          dist.df > 1 ? 0 : NaN,
          dist.df > 2 ? dist.df / (dist.df - 2) : dist.df > 1 ? Infinity : NaN,
          -5,
          5,
        ];
  const P =
    region.kind === 'below'
      ? cdf(region.b)
      : region.kind === 'above'
        ? 1 - cdf(region.a)
        : region.kind === 'between'
          ? cdf(region.b) - cdf(region.a)
          : cdf(region.a) + 1 - cdf(region.b);
  if (dist.kind === 'normal') {
    const z = (x: number) => numberText((x - dist.mean) / dist.sd, 6);
    const text =
      region.kind === 'below'
        ? `z = ${z(region.b)}`
        : region.kind === 'above'
          ? `z = ${z(region.a)}`
          : `z₁ = ${z(region.a)},  z₂ = ${z(region.b)}`;
    steps.push(step('probZ', `z = (x − μ)/σ:  ${text}`));
  } else steps.push(step('probT', `t with ${numberText(dist.df)} degrees of freedom`));
  steps.push(step('probArea', `P = ${numberText(P, 8)}`));
  const curve: XY[] = [];
  for (let i = 0; i <= 240; i += 1) {
    const x = lo + ((hi - lo) * i) / 240;
    curve.push({ x, y: pdf(x) });
  }
  const pieces: [number, number][] =
    region.kind === 'below'
      ? [[lo, region.b]]
      : region.kind === 'above'
        ? [[region.a, hi]]
        : region.kind === 'between'
          ? [[region.a, region.b]]
          : [
              [lo, region.a],
              [region.b, hi],
            ];
  const shaded = pieces
    .map(([a, b]) => [Math.max(lo, a), Math.min(hi, b)] as const)
    .filter(([a, b]) => b > a)
    .map(([a, b]) => {
      const outline: XY[] = [{ x: a, y: 0 }];
      for (let i = 0; i <= 80; i += 1) {
        const x = a + ((b - a) * i) / 80;
        outline.push({ x, y: pdf(x) });
      }
      outline.push({ x: b, y: 0 });
      return outline;
    });
  return { probability: P, mean, variance, steps, curve, shaded, bars: [] };
}

// ---------------------------------------------------------------------------------------------------------------
// Regression

export interface RegressionResult {
  readonly slope: number;
  readonly intercept: number;
  /** The correlation coefficient. */
  readonly r: number;
  readonly r2: number;
  readonly n: number;
  /** The standard errors of the slope and the intercept. */
  readonly slopeError: number;
  readonly interceptError: number;
  readonly steps: readonly Step[];
  readonly residuals: readonly number[];
}

/** Least-squares line y = mx + b through at least two points with different x values. */
export function regression(points: readonly XY[]): RegressionResult {
  const data = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const n = data.length;
  if (n < 2) throw new SolverError('regression-points');
  const mx = data.reduce((s, p) => s + p.x, 0) / n;
  const my = data.reduce((s, p) => s + p.y, 0) / n;
  const sxx = data.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  const syy = data.reduce((s, p) => s + (p.y - my) ** 2, 0);
  const sxy = data.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  if (sxx === 0) throw new SolverError('regression-points');
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const residuals = data.map((p) => p.y - (slope * p.x + intercept));
  const sse = residuals.reduce((s, e) => s + e * e, 0);
  const r = syy === 0 ? 1 : sxy / Math.sqrt(sxx * syy);
  const r2 = syy === 0 ? 1 : 1 - sse / syy;
  const s2 = n > 2 ? sse / (n - 2) : NaN;
  const slopeError = Math.sqrt(s2 / sxx);
  const interceptError = Math.sqrt(s2 * (1 / n + (mx * mx) / sxx));
  const steps: Step[] = [
    step('regressionMeans', `x̄ = ${numberText(mx)},  ȳ = ${numberText(my)}`),
    step('regressionSums', `Sxx = ${numberText(sxx)},  Sxy = ${numberText(sxy)},  Syy = ${numberText(syy)}`),
    step('regressionLine', `m = Sxy/Sxx = ${numberText(slope)},  b = ȳ − m·x̄ = ${numberText(intercept)}`),
    step('regressionFit', `r = ${numberText(r, 6)},  R² = 1 − SSE/Syy = ${numberText(r2, 6)}`),
  ];
  return { slope, intercept, r, r2, n, slopeError, interceptError, steps, residuals };
}
