// Power and sample size from exact noncentral distributions, the way G*Power works them: t tests (with TOST),
// one-way and repeated-measures ANOVA, chi-square, regression R² change, and correlations (Fisher z). It also
// covers two proportions, one proportion (exact binomial), time-to-event (Schoenfeld), and cluster designs.
import { brent } from '../../kits/num/roots';
import {
  binomialCdf,
  chiSquareQuantile,
  fQuantile,
  noncentralChiSquareSf,
  noncentralFSf,
  noncentralTCdf,
  normalCdf,
  normalQuantile,
  tQuantile,
} from '../../subjects/stats/dist';
import { check } from '../report';

export type Tails = 1 | 2;

export type Test =
  | 'tTwo'
  | 'tOne'
  | 'tost'
  | 'anova'
  | 'rmAnova'
  | 'chi2'
  | 'regression'
  | 'correlation'
  | 'proportions'
  | 'proportion'
  | 'survival';

export interface Settings {
  readonly test: Test;
  readonly tails: Tails;
  /** n2/n1 for a two-sample t test or two proportions. */
  readonly ratio: number;
  /** Groups (ANOVA), measurements (repeated measures), or tested predictors (regression). */
  readonly groups: number;
  readonly df: number;
  /** Predictors in the full model (regression). */
  readonly predictors: number;
  /** Correlation among repeated measures, and the sphericity ε. */
  readonly rho: number;
  readonly epsilon: number;
  /** The equivalence margin (TOST), in d units. */
  readonly margin: number;
  /** The proportion under the null, or in group 1. */
  readonly p0: number;
  readonly continuity: boolean;
  /** For survival: the chance a subject has the event during the study. */
  readonly eventRate: number;
}

export interface Solution {
  /** The size the test is worked at: per group, total, pairs, or events. */
  readonly n: number;
  readonly power: number;
  readonly critical: number;
  readonly ncp: number;
  readonly df1: number;
  readonly df2: number;
}

const z = (p: number) => normalQuantile(p);

function tPower(ncp: number, df: number, alpha: number, tails: Tails): { power: number; critical: number } {
  if (Math.abs(ncp) > 35) {
    // Beyond the noncentral t's working range the power is 1 to many digits; the normal form says so.
    const critical = tQuantile(1 - alpha / tails, df);
    const power = normalCdf(Math.abs(ncp) - critical) + (tails === 2 ? normalCdf(-Math.abs(ncp) - critical) : 0);
    return { power, critical };
  }
  if (tails === 1) {
    const critical = tQuantile(1 - alpha, df);
    return { power: 1 - noncentralTCdf(critical, df, ncp), critical };
  }
  const critical = tQuantile(1 - alpha / 2, df);
  return { power: 1 - noncentralTCdf(critical, df, ncp) + noncentralTCdf(-critical, df, ncp), critical };
}

/** The power of the chosen test at size n, effect size es, and level alpha. */
export function powerAt(s: Settings, n: number, es: number, alpha: number): Solution {
  switch (s.test) {
    case 'tTwo': {
      const n2 = n * s.ratio;
      const ncp = es * Math.sqrt((n * n2) / (n + n2));
      const df = n + n2 - 2;
      return { n, ...tPower(ncp, df, alpha, s.tails), ncp, df1: df, df2: Number.NaN };
    }
    case 'tOne':
      return {
        n,
        ...tPower(es * Math.sqrt(n), n - 1, alpha, s.tails),
        ncp: es * Math.sqrt(n),
        df1: n - 1,
        df2: Number.NaN,
      };
    case 'tost': {
      // Two one-sided tests at alpha each, for a true effect es within ±margin (two independent groups of n).
      const scale = Math.sqrt(n / 2);
      const df = 2 * n - 2;
      const critical = tQuantile(1 - alpha, df);
      const power = Math.max(
        0,
        noncentralTCdf(-critical, df, (es - s.margin) * scale) - noncentralTCdf(critical, df, (es + s.margin) * scale),
      );
      return { n, power, critical, ncp: (s.margin - Math.abs(es)) * scale, df1: df, df2: Number.NaN };
    }
    case 'anova':
    case 'regression': {
      const df1 = s.test === 'anova' ? s.groups - 1 : s.groups;
      const N = s.test === 'anova' ? n * s.groups : n;
      const df2 = s.test === 'anova' ? N - s.groups : N - s.predictors - 1;
      const ncp = es * es * N;
      const critical = fQuantile(1 - alpha, df1, df2);
      return { n, power: noncentralFSf(critical, df1, df2, ncp), critical, ncp, df1, df2 };
    }
    case 'rmAnova': {
      const m = s.groups;
      const ncp = (es * es * n * m * s.epsilon) / (1 - s.rho);
      const df1 = (m - 1) * s.epsilon;
      const df2 = (n - 1) * (m - 1) * s.epsilon;
      const critical = fQuantile(1 - alpha, df1, df2);
      return { n, power: noncentralFSf(critical, df1, df2, ncp), critical, ncp, df1, df2 };
    }
    case 'chi2': {
      const ncp = es * es * n;
      const critical = chiSquareQuantile(1 - alpha, s.df);
      return { n, power: noncentralChiSquareSf(critical, s.df, ncp), critical, ncp, df1: s.df, df2: Number.NaN };
    }
    case 'correlation': {
      const zr = Math.atanh(es) * Math.sqrt(n - 3);
      const critical = z(1 - alpha / s.tails);
      const power = s.tails === 1 ? normalCdf(zr - critical) : normalCdf(zr - critical) + normalCdf(-zr - critical);
      return { n, power, critical, ncp: zr, df1: Number.NaN, df2: Number.NaN };
    }
    case 'proportions': {
      const p1 = s.p0;
      const p2 = es;
      const n2 = n * s.ratio;
      const pbar = (p1 * n + p2 * n2) / (n + n2);
      const se0 = Math.sqrt(pbar * (1 - pbar) * (1 / n + 1 / n2));
      const se1 = Math.sqrt((p1 * (1 - p1)) / n + (p2 * (1 - p2)) / n2);
      const critical = z(1 - alpha / s.tails);
      const cc = s.continuity ? 0.5 * (1 / n + 1 / n2) : 0;
      const gap = Math.max(0, Math.abs(p2 - p1) - cc);
      const power = normalCdf((gap - critical * se0) / se1);
      return { n, power, critical, ncp: gap / se1, df1: Number.NaN, df2: Number.NaN };
    }
    case 'proportion': {
      // The exact binomial test of p0 against the true p (es), one- or two-sided, by its rejection region.
      const lowerCut = s.tails === 2 ? alpha / 2 : es < s.p0 ? alpha : 0;
      const upperCut = s.tails === 2 ? alpha / 2 : es > s.p0 ? alpha : 0;
      let lo = -1;
      while (lo + 1 <= n && binomialCdf(lo + 1, n, s.p0) <= lowerCut) lo += 1;
      let hi = n + 1;
      while (hi - 1 >= 0 && 1 - binomialCdf(hi - 2, n, s.p0) <= upperCut) hi -= 1;
      const power = (lo >= 0 ? binomialCdf(lo, n, es) : 0) + (hi <= n ? 1 - binomialCdf(hi - 1, n, es) : 0);
      return { n, power, critical: hi <= n ? hi : lo, ncp: Number.NaN, df1: Number.NaN, df2: Number.NaN };
    }
    default: {
      // Schoenfeld: the log-rank test's power from the number of events n at hazard ratio es.
      const p = 1 / (1 + s.ratio);
      const zr = Math.abs(Math.log(es)) * Math.sqrt(n * p * (1 - p));
      const critical = z(1 - alpha / s.tails);
      return { n, power: normalCdf(zr - critical), critical, ncp: zr, df1: Number.NaN, df2: Number.NaN };
    }
  }
}

/** The smallest size this test can be worked at. */
const smallest = (s: Settings): number =>
  s.test === 'tOne'
    ? 2
    : s.test === 'correlation'
      ? 4
      : s.test === 'regression'
        ? s.predictors + 2
        : s.test === 'anova'
          ? 2
          : s.test === 'rmAnova'
            ? 2
            : s.test === 'proportion'
              ? 1
              : s.test === 'chi2' || s.test === 'survival'
                ? 1
                : 2;

export const MAX_N = 10_000_000;

export function checkSettings(s: Settings, es: number, alpha: number): void {
  check(alpha > 0 && alpha < 1, 'alphaRange');
  check(Number.isFinite(es), 'effectNumber');
  if (s.test === 'tTwo' || s.test === 'proportions') check(s.ratio > 0, 'ratioPositive');
  if (s.test === 'anova' || s.test === 'rmAnova') check(Number.isInteger(s.groups) && s.groups >= 2, 'groupsTwo');
  if (s.test === 'regression')
    check(Number.isInteger(s.groups) && s.groups >= 1 && s.predictors >= s.groups, 'predictorsRange');
  if (s.test === 'chi2') check(Number.isInteger(s.df) && s.df >= 1, 'dfWhole');
  if (s.test === 'rmAnova') {
    check(s.rho > -1 && s.rho < 1, 'correlationOpen');
    check(s.epsilon >= 1 / (s.groups - 1) - 1e-12 && s.epsilon <= 1, 'epsilonRange');
  }
  if (s.test === 'correlation') check(es > -1 && es < 1 && es !== 0, 'rhoRange');
  if (s.test === 'proportions' || s.test === 'proportion') {
    check(s.p0 > 0 && s.p0 < 1 && es > 0 && es < 1 && es !== s.p0, 'proportionsRange');
  }
  if (s.test === 'survival') check(es > 0 && es !== 1, 'hazardRange');
  if (s.test === 'tost') check(s.margin > 0 && Math.abs(es) < s.margin, 'marginRange');
  if (
    s.test !== 'correlation' &&
    s.test !== 'proportions' &&
    s.test !== 'proportion' &&
    s.test !== 'survival' &&
    s.test !== 'tost'
  ) {
    check(es !== 0, 'effectZero');
  }
}

/** The smallest whole size that reaches the target power: doubling until it does, then bisection. */
export function solveN(
  s: Settings,
  es: number,
  alpha: number,
  target: number,
): { solution: Solution; steps: number[] } {
  checkSettings(s, es, alpha);
  check(target > alpha / s.tails && target < 1, 'powerRange');
  let lo = smallest(s);
  const first = powerAt(s, lo, es, alpha);
  if (first.power >= target) return { solution: first, steps: [lo] };
  let hi = lo * 2;
  const steps = [lo];
  while (powerAt(s, hi, es, alpha).power < target) {
    lo = hi;
    hi *= 2;
    steps.push(hi);
    check(hi <= MAX_N, 'nTooLarge');
  }
  // The exact binomial power saw-tooths, so for it take the first n from the bottom that reaches the target.
  if (s.test === 'proportion') {
    for (let n = smallest(s); n <= hi; n += 1) {
      const sol = powerAt(s, n, es, alpha);
      if (sol.power >= target) return { solution: sol, steps };
    }
  }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (powerAt(s, mid, es, alpha).power >= target) hi = mid;
    else lo = mid;
    steps.push(mid);
  }
  return { solution: powerAt(s, hi, es, alpha), steps };
}

/** The effect size that the size n detects with the target power. */
export function solveEffect(s: Settings, n: number, alpha: number, target: number): Solution & { es: number } {
  check(target > alpha && target < 1, 'powerRange');
  const [lo, hi] =
    s.test === 'correlation'
      ? [1e-6, 0.999999]
      : s.test === 'proportions' || s.test === 'proportion'
        ? [s.p0 + 1e-6, 1 - 1e-6]
        : s.test === 'survival'
          ? [1e-4, 1 - 1e-6]
          : s.test === 'tost'
            ? [0, s.margin - 1e-9]
            : [1e-6, 50];
  const f = (es: number) => powerAt(s, n, es, alpha).power - target;
  check(f(lo) * f(hi) <= 0, 'noEffect');
  const es = brent(f, lo, hi, 1e-10).x;
  return { ...powerAt(s, n, es, alpha), es };
}

/** The level alpha at which size n and effect es give the target power. */
export function solveAlpha(s: Settings, n: number, es: number, target: number): Solution & { alpha: number } {
  checkSettings(s, es, 0.05);
  const f = (a: number) => powerAt(s, n, es, a).power - target;
  check(f(1e-8) * f(0.5) <= 0, 'noAlpha');
  const alpha = brent(f, 1e-8, 0.5, 1e-12).x;
  return { ...powerAt(s, n, es, alpha), alpha };
}

/** The unrounded closed forms the planning formulas give, shown beside the exact search. */
export function closedForm(s: Settings, es: number, alpha: number, target: number): number | null {
  const za = z(1 - alpha / s.tails);
  const zb = z(target);
  if (s.test === 'correlation') return ((za + zb) / Math.atanh(es)) ** 2 + 3;
  if (s.test === 'survival') {
    const p = 1 / (1 + s.ratio);
    return (za + zb) ** 2 / (p * (1 - p) * Math.log(es) ** 2);
  }
  if (s.test === 'proportions' && s.ratio === 1) {
    const p1 = s.p0;
    const p2 = es;
    const pbar = (p1 + p2) / 2;
    const n =
      (za * Math.sqrt(2 * pbar * (1 - pbar)) + zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2 / (p1 - p2) ** 2;
    return s.continuity ? (n / 4) * (1 + Math.sqrt(1 + 4 / (n * Math.abs(p1 - p2)))) ** 2 : n;
  }
  return null;
}

/** Converting effect sizes: from d, and from r, f, f², η², or an odds ratio to d (two equal groups). */
export function convertEffect(kind: 'd' | 'r' | 'f' | 'f2' | 'eta2' | 'or', value: number) {
  check(Number.isFinite(value), 'effectNumber');
  let d: number;
  if (kind === 'd') d = value;
  else if (kind === 'r') {
    check(value > -1 && value < 1, 'rhoRange');
    d = (2 * value) / Math.sqrt(1 - value * value);
  } else if (kind === 'f') d = 2 * value;
  else if (kind === 'f2') {
    check(value >= 0, 'effectNumber');
    d = 2 * Math.sqrt(value);
  } else if (kind === 'eta2') {
    check(value >= 0 && value < 1, 'eta2Range');
    d = 2 * Math.sqrt(value / (1 - value));
  } else {
    check(value > 0, 'oddsPositive');
    d = (Math.log(value) * Math.sqrt(3)) / Math.PI;
  }
  const f = Math.abs(d) / 2;
  return {
    d,
    r: d / Math.sqrt(d * d + 4),
    f,
    f2: f * f,
    eta2: (f * f) / (1 + f * f),
    or: Math.exp((d * Math.PI) / Math.sqrt(3)),
  };
}

/** The design effect of clusters of size m with intraclass correlation ICC: multiply n by it. */
export const designEffect = (m: number, icc: number): number => {
  check(m >= 1 && icc >= 0 && icc <= 1, 'clusterRange');
  return 1 + (m - 1) * icc;
};
