// The measures of the epidemiology tool as plain functions: 2 × 2 measures of effect with their intervals, the
// Mantel-Haenszel estimates with the Breslow-Day test, diagnostic accuracy, and rates with exact intervals.
// Direct and indirect standardization are here too.
import { chiSquareSf, clopperPearson, garwood, normalQuantile, wilson } from '../../subjects/stats/dist';
import type { Interval } from '../../subjects/stats/dist';
import { check } from '../report';

export interface Estimate {
  readonly value: number;
  readonly lower: number;
  readonly upper: number;
}

const z = (confidence: number): number => normalQuantile(1 - (1 - confidence) / 2);

export function checkConfidence(confidence: number): void {
  check(confidence > 0 && confidence < 1, 'confidenceRange');
}

function checkCounts(values: readonly number[]): void {
  for (const v of values) check(Number.isFinite(v) && v >= 0, 'negativeCount', { text: String(v) });
}

/** A log-scale interval: exp(ln value ± z · se). */
/** A log-scale interval around `center`, with `value` as the point estimate (they differ after a 0.5 correction). */
const logInterval = (value: number, se: number, zz: number, center = value): Estimate => ({
  value,
  lower: Math.exp(Math.log(center) - zz * se),
  upper: Math.exp(Math.log(center) + zz * se),
});

export interface TwoByTwo {
  /** Exposed cases, exposed non-cases, unexposed cases, unexposed non-cases. */
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
}

export interface Effect {
  readonly riskExposed: number;
  readonly riskUnexposed: number;
  readonly rr: Estimate;
  readonly or: Estimate;
  readonly rd: Estimate;
  /** The number needed to treat (RD < 0) or to harm (RD > 0), and its interval when RD's interval excludes 0. */
  readonly nn: number;
  readonly nnInterval: Interval | null;
  readonly afExposed: number;
  readonly paf: number;
  readonly seLogRr: number;
  readonly seLogOr: number;
  /** The RR and OR the log intervals are centered on: the raw ones, or the 0.5-corrected ones when a cell is 0. */
  readonly rrCenter: number;
  readonly orCenter: number;
  /** Whether 0.5 was added to every cell for the log intervals (not the point estimates) because a cell was 0. */
  readonly corrected: boolean;
}

/** The measures of a cohort or cross-sectional 2 × 2 table, with log (RR), Woolf (OR), and Wald (RD) intervals. */
export function effect(t: TwoByTwo, confidence = 0.95): Effect {
  checkCounts([t.a, t.b, t.c, t.d]);
  checkConfidence(confidence);
  check(t.a + t.b > 0 && t.c + t.d > 0, 'emptyGroup');
  const zz = z(confidence);
  const n1 = t.a + t.b;
  const n0 = t.c + t.d;
  const r1 = t.a / n1;
  const r0 = t.c / n0;
  const corrected = [t.a, t.b, t.c, t.d].some((v) => v === 0);
  const h = corrected ? 0.5 : 0;
  const [a, b, c, d] = [t.a + h, t.b + h, t.c + h, t.d + h];
  const seLogRr = Math.sqrt(1 / a - 1 / (a + b) + 1 / c - 1 / (c + d));
  const seLogOr = Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d);
  const rrCenter = a / (a + b) / (c / (c + d));
  const orCenter = (a * d) / (b * c);
  const rawOr = t.a * t.d === 0 && t.b * t.c === 0 ? Number.NaN : (t.a * t.d) / (t.b * t.c);
  const rd = r1 - r0;
  const seRd = Math.sqrt((r1 * (1 - r1)) / n1 + (r0 * (1 - r0)) / n0);
  const rdInterval = { value: rd, lower: rd - zz * seRd, upper: rd + zz * seRd };
  const excludesZero = rdInterval.lower > 0 || rdInterval.upper < 0;
  const rr = r1 === 0 && r0 === 0 ? Number.NaN : r1 / r0;
  const total = (t.a + t.c) / (n1 + n0);
  return {
    riskExposed: r1,
    riskUnexposed: r0,
    rr: logInterval(rr, seLogRr, zz, rrCenter),
    or: logInterval(rawOr, seLogOr, zz, orCenter),
    rd: rdInterval,
    nn: rd === 0 ? Number.POSITIVE_INFINITY : 1 / Math.abs(rd),
    nnInterval: excludesZero
      ? {
          lower: 1 / Math.max(Math.abs(rdInterval.lower), Math.abs(rdInterval.upper)),
          upper: 1 / Math.min(Math.abs(rdInterval.lower), Math.abs(rdInterval.upper)),
        }
      : null,
    afExposed: rr === Number.POSITIVE_INFINITY ? 1 : (rr - 1) / rr,
    paf: total > 0 ? (total - r0) / total : Number.NaN,
    seLogRr,
    seLogOr,
    rrCenter,
    orCenter,
    corrected,
  };
}

export interface Pooled {
  readonly orMh: Estimate;
  readonly rrMh: number;
  readonly cmh: number;
  readonly pCmh: number;
  readonly breslowDay: number;
  readonly df: number;
  readonly pBreslowDay: number;
  readonly crude: number;
  readonly strata: readonly { or: number; rr: number }[];
}

/** The count A in a stratum's top-left cell whose odds ratio is `psi`, keeping the stratum's margins. */
function fittedA(t: TwoByTwo, psi: number): number {
  const m1 = t.a + t.c;
  const n1 = t.a + t.b;
  const n = t.a + t.b + t.c + t.d;
  const lo = Math.max(0, m1 - (n - n1));
  const hi = Math.min(m1, n1);
  // Solve A (n − n1 − m1 + A) = psi (n1 − A)(m1 − A), a quadratic with one root between lo and hi.
  const qa = 1 - psi;
  const qb = n - n1 - m1 + psi * (n1 + m1);
  const qc = -psi * n1 * m1;
  if (Math.abs(qa) < 1e-12) return -qc / qb;
  const root = Math.sqrt(qb * qb - 4 * qa * qc);
  const roots = [(-qb + root) / (2 * qa), (-qb - root) / (2 * qa)];
  return roots.find((r) => r >= lo - 1e-9 && r <= hi + 1e-9) ?? roots[0];
}

/**
 * Mantel-Haenszel odds and risk ratios over strata, the Robins-Breslow-Greenland interval for the odds ratio, the
 * Cochran-Mantel-Haenszel test of no association, and the Breslow-Day test that the odds ratios are equal.
 */
export function mantelHaenszel(strata: readonly TwoByTwo[], confidence = 0.95): Pooled {
  check(strata.length >= 2, 'fewStrata');
  checkConfidence(confidence);
  for (const t of strata) {
    checkCounts([t.a, t.b, t.c, t.d]);
    check(t.a + t.b + t.c + t.d > 1, 'emptyStratum');
  }
  let r = 0;
  let s = 0;
  let pr = 0;
  let ps = 0;
  let qs = 0;
  let rrTop = 0;
  let rrBottom = 0;
  let sumA = 0;
  let sumE = 0;
  let sumV = 0;
  for (const t of strata) {
    const n = t.a + t.b + t.c + t.d;
    const ri = (t.a * t.d) / n;
    const si = (t.b * t.c) / n;
    const pi = (t.a + t.d) / n;
    const qi = (t.b + t.c) / n;
    r += ri;
    s += si;
    pr += pi * ri;
    ps += pi * si + qi * ri;
    qs += qi * si;
    rrTop += (t.a * (t.c + t.d)) / n;
    rrBottom += (t.c * (t.a + t.b)) / n;
    const n1 = t.a + t.b;
    const m1 = t.a + t.c;
    sumA += t.a;
    sumE += (n1 * m1) / n;
    sumV += (n1 * (n - n1) * m1 * (n - m1)) / (n * n * (n - 1));
  }
  check(r > 0 && s > 0, 'pooledUndefined');
  const orMh = r / s;
  const se = Math.sqrt(pr / (2 * r * r) + ps / (2 * r * s) + qs / (2 * s * s));
  // Yates' 0.5 applies only when |A - E| >= 0.5, as in R's mantelhaen.test;
  // subtracting it from a smaller gap would square a negative and inflate the statistic.
  const delta = Math.abs(sumA - sumE);
  const cmh = (delta - (delta >= 0.5 ? 0.5 : 0)) ** 2 / sumV;
  let bd = 0;
  for (const t of strata) {
    const A = fittedA(t, orMh);
    const m1 = t.a + t.c;
    const n1 = t.a + t.b;
    const n = t.a + t.b + t.c + t.d;
    const variance = 1 / (1 / A + 1 / (n1 - A) + 1 / (m1 - A) + 1 / (n - n1 - m1 + A));
    bd += (t.a - A) ** 2 / variance;
  }
  const crude = strata.reduce((sum, t) => ({ a: sum.a + t.a, b: sum.b + t.b, c: sum.c + t.c, d: sum.d + t.d }), {
    a: 0,
    b: 0,
    c: 0,
    d: 0,
  });
  return {
    orMh: logInterval(orMh, se, z(confidence)),
    rrMh: rrTop / rrBottom,
    cmh,
    pCmh: chiSquareSf(cmh, 1),
    breslowDay: bd,
    df: strata.length - 1,
    pBreslowDay: chiSquareSf(bd, strata.length - 1),
    crude: (crude.a * crude.d) / (crude.b * crude.c),
    strata: strata.map((t) => ({ or: (t.a * t.d) / (t.b * t.c), rr: t.a / (t.a + t.b) / (t.c / (t.c + t.d)) })),
  };
}

export interface Accuracy {
  readonly sensitivity: Estimate;
  readonly specificity: Estimate;
  readonly ppv: Estimate;
  readonly npv: Estimate;
  readonly lrPositive: Estimate;
  readonly lrNegative: Estimate;
  readonly accuracy: Estimate;
  readonly youden: number;
  readonly prevalence: number;
}

const wilsonEstimate = (x: number, n: number, confidence: number): Estimate => {
  if (n === 0) return { value: Number.NaN, lower: Number.NaN, upper: Number.NaN };
  const w = wilson(x, n, confidence);
  return { value: x / n, lower: w.lower, upper: w.upper };
};

/** Diagnostic accuracy from true positives, false negatives, false positives, and true negatives. */
export function accuracy(tp: number, fn: number, fp: number, tn: number, confidence = 0.95): Accuracy {
  checkCounts([tp, fn, fp, tn]);
  checkConfidence(confidence);
  check(tp + fn > 0 && fp + tn > 0, 'needBothGroups');
  const zz = z(confidence);
  const sens = tp / (tp + fn);
  const spec = tn / (fp + tn);
  // Likelihood ratios with the log method; a zero count makes its ratio's interval unbounded.
  const lrp = sens / (1 - spec);
  const lrn = (1 - sens) / spec;
  const seLrp = Math.sqrt(1 / tp - 1 / (tp + fn) + 1 / fp - 1 / (fp + tn));
  const seLrn = Math.sqrt(1 / fn - 1 / (tp + fn) + 1 / tn - 1 / (fp + tn));
  const ratio = (value: number, se: number): Estimate =>
    Number.isFinite(se) && value > 0 && Number.isFinite(value)
      ? logInterval(value, se, zz)
      : { value, lower: Number.NaN, upper: Number.NaN };
  const n = tp + fn + fp + tn;
  return {
    sensitivity: wilsonEstimate(tp, tp + fn, confidence),
    specificity: wilsonEstimate(tn, fp + tn, confidence),
    ppv: wilsonEstimate(tp, tp + fp, confidence),
    npv: wilsonEstimate(tn, tn + fn, confidence),
    lrPositive: ratio(lrp, seLrp),
    lrNegative: ratio(lrn, seLrn),
    accuracy: wilsonEstimate(tp + tn, n, confidence),
    youden: sens + spec - 1,
    prevalence: (tp + fn) / n,
  };
}

/** The probability of disease after a positive and after a negative test, from the probability before it. */
export function postTest(
  sensitivity: number,
  specificity: number,
  prior: number,
): { positive: number; negative: number } {
  check(prior >= 0 && prior <= 1, 'prevalenceRange');
  const pos = sensitivity * prior + (1 - specificity) * (1 - prior);
  const neg = (1 - sensitivity) * prior + specificity * (1 - prior);
  return {
    positive: pos === 0 ? Number.NaN : (sensitivity * prior) / pos,
    negative: neg === 0 ? Number.NaN : ((1 - sensitivity) * prior) / neg,
  };
}

export interface RateCompare {
  readonly rate1: Estimate;
  readonly rate0: Estimate;
  readonly ratio: Estimate;
  readonly difference: Estimate;
}

const poissonRate = (cases: number, time: number, confidence: number): Estimate => {
  const g = garwood(cases, confidence);
  return { value: cases / time, lower: g.lower / time, upper: g.upper / time };
};

/**
 * Incidence rates in 2 groups with exact Poisson intervals, the rate ratio with its exact interval (from the
 * binomial split of the cases), and the rate difference with a Wald interval.
 */
export function compareRates(
  cases1: number,
  time1: number,
  cases0: number,
  time0: number,
  confidence = 0.95,
): RateCompare {
  checkCounts([cases1, cases0]);
  checkConfidence(confidence);
  check(Number.isInteger(cases1) && Number.isInteger(cases0), 'wholeCount', { text: `${cases1}, ${cases0}` });
  check(time1 > 0 && time0 > 0 && Number.isFinite(time1) && Number.isFinite(time0), 'timePositive');
  check(cases1 + cases0 > 0, 'noCases');
  const split = clopperPearson(cases1, cases1 + cases0, confidence);
  const toRatio = (p: number) => (p >= 1 ? Number.POSITIVE_INFINITY : (p / (1 - p)) * (time0 / time1));
  const r1 = cases1 / time1;
  const r0 = cases0 / time0;
  const se = Math.sqrt(cases1 / time1 ** 2 + cases0 / time0 ** 2);
  const zz = z(confidence);
  return {
    rate1: poissonRate(cases1, time1, confidence),
    rate0: poissonRate(cases0, time0, confidence),
    ratio: {
      value: r0 === 0 ? Number.POSITIVE_INFINITY : r1 / r0,
      lower: toRatio(split.lower),
      upper: toRatio(split.upper),
    },
    difference: { value: r1 - r0, lower: r1 - r0 - zz * se, upper: r1 - r0 + zz * se },
  };
}

export interface Stratum {
  readonly label: string;
  readonly cases: number;
  readonly time: number;
}

export interface Direct {
  readonly rate: Estimate;
  readonly crude: number;
  readonly weights: readonly number[];
  readonly rates: readonly number[];
}

/**
 * Direct standardization: Σ w_k r_k with the standard's weights scaled to add to 1. The interval is the normal one
 * from var = Σ w_k² d_k / n_k².
 */
export function directRate(strata: readonly Stratum[], standard: readonly number[], confidence = 0.95): Direct {
  check(strata.length >= 1, 'empty');
  check(standard.length === strata.length, 'standardLength', { need: `${strata.length}`, have: `${standard.length}` });
  checkConfidence(confidence);
  for (const s of strata) {
    checkCounts([s.cases]);
    check(s.time > 0 && Number.isFinite(s.time), 'timePositive');
  }
  check(
    standard.every((w) => Number.isFinite(w) && w >= 0),
    'negativeWeight',
  );
  const total = standard.reduce((a, b) => a + b, 0);
  check(total > 0, 'zeroWeights');
  const weights = standard.map((w) => w / total);
  const rates = strata.map((s) => s.cases / s.time);
  const value = weights.reduce((sum, w, k) => sum + w * rates[k], 0);
  const variance = weights.reduce((sum, w, k) => sum + (w * w * strata[k].cases) / strata[k].time ** 2, 0);
  const half = z(confidence) * Math.sqrt(variance);
  const cases = strata.reduce((a, s) => a + s.cases, 0);
  const time = strata.reduce((a, s) => a + s.time, 0);
  return {
    rate: { value, lower: Math.max(0, value - half), upper: value + half },
    crude: cases / time,
    weights,
    rates,
  };
}

export interface Indirect {
  readonly observed: number;
  readonly expected: number;
  readonly smr: Estimate;
}

/** Indirect standardization: E = Σ (standard rate × person-time); SMR = O/E with Garwood's exact interval. */
export function smr(observed: number, expectedCount: number, confidence = 0.95): Indirect {
  checkCounts([observed]);
  check(Number.isInteger(observed), 'wholeCount', { text: String(observed) });
  check(expectedCount > 0 && Number.isFinite(expectedCount), 'expectedPositive');
  checkConfidence(confidence);
  const g = garwood(observed, confidence);
  return {
    observed,
    expected: expectedCount,
    smr: { value: observed / expectedCount, lower: g.lower / expectedCount, upper: g.upper / expectedCount },
  };
}

/** A proportion (prevalence, attack rate, case fatality) with its Wilson and exact Clopper-Pearson intervals. */
export function proportion(cases: number, total: number, confidence = 0.95) {
  checkCounts([cases, total]);
  check(Number.isInteger(cases) && Number.isInteger(total), 'wholeCount', { text: `${cases}, ${total}` });
  check(total > 0 && cases <= total, 'casesAboveTotal');
  checkConfidence(confidence);
  return {
    value: cases / total,
    wilson: wilson(cases, total, confidence),
    exact: clopperPearson(cases, total, confidence),
  };
}
