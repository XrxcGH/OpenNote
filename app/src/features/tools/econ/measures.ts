// Measurement in economics as pure functions over lists of numbers.
import { invert } from './num';

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const dot = (xs: readonly number[], ys: readonly number[]) => xs.reduce((a, x, i) => a + x * ys[i], 0);

export interface PriceIndexes {
  laspeyres: number;
  paasche: number;
  fisher: number;
}

/** Index numbers of a basket: base prices p0 and quantities q0, current prices p1 and quantities q1. */
export function priceIndexes(
  p0: readonly number[],
  q0: readonly number[],
  p1: readonly number[],
  q1: readonly number[],
): PriceIndexes | null {
  const n = p0.length;
  if (n === 0 || [q0, p1, q1].some((x) => x.length !== n)) return null;
  const base = dot(p0, q0);
  const later = dot(p0, q1);
  if (!(base > 0) || !(later > 0)) return null;
  const laspeyres = dot(p1, q0) / base;
  const paasche = dot(p1, q1) / later;
  return { laspeyres, paasche, fisher: Math.sqrt(laspeyres * paasche) };
}

/** A chained index from year-to-year links (each the index of one year on the one before), starting at 100. */
export function chain(links: readonly number[]): number[] {
  const out = [100];
  for (const link of links) out.push(out[out.length - 1] * link);
  return out;
}

/** The value in the target period's money: nominal times the target index over the source index. */
export const adjust = (nominal: number, sourceIndex: number, targetIndex: number): number | null =>
  sourceIndex > 0 && targetIndex > 0 ? (nominal * targetIndex) / sourceIndex : null;

export const cagr = (start: number, end: number, years: number): number | null =>
  start > 0 && end > 0 && years > 0 ? (end / start) ** (1 / years) - 1 : null;

/** Years to double at a growth rate in percent by the rule of 70, and exactly. */
export function doubling(percent: number): { rule: number; exact: number } | null {
  return percent > 0 ? { rule: 70 / percent, exact: Math.log(2) / Math.log(1 + percent / 100) } : null;
}

export function gini(values: readonly number[], weights?: readonly number[]): number | null {
  const w = weights ?? values.map(() => 1);
  if (values.length < 1 || w.length !== values.length || values.some((x) => x < 0) || w.some((x) => !(x > 0)))
    return null;
  const total = sum(w);
  const mean = dot(values, w) / total;
  if (!(mean > 0)) return null;
  let diff = 0;
  for (let i = 0; i < values.length; i += 1)
    for (let j = 0; j < values.length; j += 1) diff += w[i] * w[j] * Math.abs(values[i] - values[j]);
  return diff / (2 * total * total * mean);
}

/** Lorenz curve points (population share, income share), starting at the origin. */
export function lorenz(values: readonly number[]): [number, number][] | null {
  const sorted = [...values].sort((a, b) => a - b);
  const total = sum(sorted);
  if (sorted.length === 0 || sorted.some((x) => x < 0) || !(total > 0)) return null;
  let run = 0;
  return [[0, 0], ...sorted.map((x, i) => [(i + 1) / sorted.length, (run += x) / total] as [number, number])];
}

export interface Inequality {
  theilT: number;
  theilL: number;
  atkinson: number;
  p90p10: number | null;
  palma: number | null;
}

const quantile = (sorted: readonly number[], q: number): number => {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

/** Theil T and L, Atkinson with aversion epsilon, the 90/10 ratio, and the Palma ratio (top 10% over bottom 40%). */
export function inequality(values: readonly number[], epsilon: number): Inequality | null {
  if (values.length < 2 || values.some((x) => !(x > 0)) || epsilon < 0) return null;
  const n = values.length;
  const mean = sum(values) / n;
  const sorted = [...values].sort((a, b) => a - b);
  const atkinson =
    epsilon === 1
      ? 1 - Math.exp(sum(values.map(Math.log)) / n) / mean
      : 1 - (sum(values.map((x) => (x / mean) ** (1 - epsilon))) / n) ** (1 / (1 - epsilon));
  // Cumulative income of the poorest share p of people, interpolating inside the person the cut falls in, so the
  // 40% and 90% cuts are right when n is not a multiple of 10 (the same piecewise-linear Lorenz curve).
  const below = (p: number) => {
    const k = n * p;
    const whole = Math.min(n, Math.floor(k + 1e-9));
    return sum(sorted.slice(0, whole)) + (whole < n ? (k - whole) * sorted[whole] : 0);
  };
  const top = sum(sorted) - below(0.9);
  const bottom = below(0.4);
  return {
    theilT: sum(values.map((x) => (x / mean) * Math.log(x / mean))) / n,
    theilL: sum(values.map((x) => Math.log(mean / x))) / n,
    atkinson,
    p90p10: quantile(sorted, 0.9) / quantile(sorted, 0.1),
    palma: n >= 10 && bottom > 0 ? top / bottom : null,
  };
}

export interface Poverty {
  headcount: number;
  gap: number;
  squaredGap: number;
}

/** Foster-Greer-Thorbecke measures of alpha 0, 1 and 2 against a poverty line. */
export function poverty(incomes: readonly number[], line: number): Poverty | null {
  if (incomes.length === 0 || !(line > 0) || incomes.some((x) => x < 0)) return null;
  const fgt = (alpha: number) =>
    sum(incomes.map((y) => (y < line ? ((line - y) / line) ** alpha : 0))) / incomes.length;
  return { headcount: fgt(0), gap: fgt(1), squaredGap: fgt(2) };
}

export interface Segregation {
  dissimilarity: number;
  isolationA: number;
  exposureAToB: number;
  entropy: number;
}

/** Segregation of group A from group B across areas, from their counts in each. */
export function segregation(a: readonly number[], b: readonly number[]): Segregation | null {
  if (a.length < 2 || a.length !== b.length || [...a, ...b].some((x) => x < 0)) return null;
  const A = sum(a);
  const B = sum(b);
  if (!(A > 0) || !(B > 0)) return null;
  const t = a.map((x, i) => x + b[i]);
  const total = A + B;
  const entropyOf = (p: number) => (p <= 0 || p >= 1 ? 0 : -p * Math.log(p) - (1 - p) * Math.log(1 - p));
  const overall = entropyOf(A / total);
  return {
    dissimilarity: sum(a.map((x, i) => Math.abs(x / A - b[i] / B))) / 2,
    isolationA: sum(a.map((x, i) => (t[i] > 0 ? (x / A) * (x / t[i]) : 0))),
    exposureAToB: sum(a.map((x, i) => (t[i] > 0 ? (x / A) * (b[i] / t[i]) : 0))),
    entropy: sum(t.map((ti, i) => (ti > 0 ? (ti * (overall - entropyOf(a[i] / ti))) / (total * overall) : 0))),
  };
}

/** Location quotients: each industry's share of regional jobs over its share of national jobs. */
export function locationQuotients(region: readonly number[], nation: readonly number[]): number[] | null {
  const r = sum(region);
  const n = sum(nation);
  if (region.length === 0 || region.length !== nation.length || !(r > 0) || !(n > 0) || nation.some((x) => !(x > 0)))
    return null;
  return region.map((x, i) => x / r / (nation[i] / n));
}

export interface ShiftShare {
  national: number[];
  mix: number[];
  competitive: number[];
  totals: { national: number; mix: number; competitive: number; change: number };
}

/** Shift-share: the change in regional jobs split into the national growth, industry mix, and competitive effects. */
export function shiftShare(
  region0: readonly number[],
  region1: readonly number[],
  nation0: readonly number[],
  nation1: readonly number[],
): ShiftShare | null {
  const n = region0.length;
  if (n === 0 || [region1, nation0, nation1].some((x) => x.length !== n) || nation0.some((x) => !(x > 0))) return null;
  const gN = sum(nation1) / sum(nation0) - 1;
  const national = region0.map((e) => e * gN);
  const mix = region0.map((e, i) => e * (nation1[i] / nation0[i] - 1 - gN));
  const competitive = region0.map((e, i) => region1[i] - e * (nation1[i] / nation0[i]));
  return {
    national,
    mix,
    competitive,
    totals: {
      national: sum(national),
      mix: sum(mix),
      competitive: sum(competitive),
      change: sum(region1) - sum(region0),
    },
  };
}

/** The Leontief inverse (I - A)^-1 and the type I output multipliers (its column sums). */
export function leontief(A: readonly (readonly number[])[]): { inverse: number[][]; multipliers: number[] } | null {
  const n = A.length;
  if (n === 0 || A.some((row) => row.length !== n)) return null;
  const inverse = invert(A.map((row, i) => row.map((x, j) => (i === j ? 1 : 0) - x)));
  if (!inverse) return null;
  return { inverse, multipliers: inverse[0].map((_c, j) => sum(inverse.map((row) => row[j]))) };
}

/** The Human Development Index: the geometric mean of the health, education, and income indices. */
export const hdi = (health: number, education: number, income: number): number | null =>
  [health, education, income].every((x) => x > 0 && x <= 1) ? (health * education * income) ** (1 / 3) : null;

/** A dimension index between goalposts; income uses logarithms. */
export function dimensionIndex(value: number, min: number, max: number, log = false): number | null {
  if (!(max > min) || (log && !(min > 0))) return null;
  const f = log ? Math.log : (x: number) => x;
  return Math.min(1, Math.max(0, (f(value) - f(min)) / (f(max) - f(min))));
}

export interface Bracket {
  from: number;
  rate: number;
}

export interface TaxResult {
  tax: number;
  average: number;
  marginal: number;
  pieces: { from: number; to: number | null; rate: number; amount: number }[];
}

/** Tax on an income with brackets that start at `from` and charge `rate` (a fraction) on income above it. */
export function taxOn(income: number, brackets: readonly Bracket[]): TaxResult | null {
  const sorted = [...brackets].sort((a, b) => a.from - b.from);
  if (
    income < 0 ||
    sorted.length === 0 ||
    sorted[0].from !== 0 ||
    sorted.some((b, i) => i > 0 && b.from === sorted[i - 1].from)
  )
    return null;
  const pieces = sorted.map((b, i) => {
    const to = i + 1 < sorted.length ? sorted[i + 1].from : null;
    const top = to === null ? income : Math.min(income, to);
    return { from: b.from, to, rate: b.rate, amount: Math.max(0, top - b.from) * b.rate };
  });
  const tax = sum(pieces.map((p) => p.amount));
  const marginal = [...sorted].reverse().find((b) => income >= b.from)?.rate ?? sorted[0].rate;
  return { tax, average: income > 0 ? tax / income : 0, marginal, pieces };
}

/** Federal income tax brackets by tax year, taxable income: 2024 from IRS Revenue Procedure 2023-34, 2025 from
 * 2024-40, 2026 from 2025-32. */
type Schedules = Record<'single' | 'joint', readonly Bracket[]>;
const RATES = [0.1, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37];
const ladder = (starts: readonly number[]): readonly Bracket[] => starts.map((from, i) => ({ from, rate: RATES[i]! }));
export const FEDERAL_BY_YEAR: Record<number, Schedules> = {
  2024: {
    single: ladder([0, 11600, 47150, 100525, 191950, 243725, 609350]),
    joint: ladder([0, 23200, 94300, 201050, 383900, 487450, 731200]),
  },
  2025: {
    single: ladder([0, 11925, 48475, 103350, 197300, 250525, 626350]),
    joint: ladder([0, 23850, 96950, 206700, 394600, 501050, 751600]),
  },
  2026: {
    single: ladder([0, 12400, 50400, 105700, 201775, 256225, 640600]),
    joint: ladder([0, 24800, 100800, 211400, 403550, 512450, 768700]),
  },
};
export const FEDERAL_YEARS = Object.keys(FEDERAL_BY_YEAR).map(Number);
export const FEDERAL_YEAR = 2024;
export const FEDERAL: Schedules = FEDERAL_BY_YEAR[FEDERAL_YEAR]!;
