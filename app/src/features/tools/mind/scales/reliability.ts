// Reliability of a scale. It gives Cronbach's alpha (raw and standardized) with Feldt's interval and alpha if
// each item were deleted. It gives the item-total and item-rest correlations. For items scored 0 or 1 it gives
// KR-20 and KR-21. It splits the test in halves with the Spearman-Brown correction, and runs the prophecy for a
// longer or shorter test.
import { correlation, fQuantile, mean, sd, sum, variance } from '../kit/num';
import { fail } from '../kit/types';

export interface ItemStats {
  readonly mean: number;
  readonly sd: number;
  readonly itemTotal: number;
  readonly itemRest: number;
  readonly alphaIfDeleted: number;
}

export interface Reliability {
  readonly respondents: number;
  readonly items: number;
  readonly alpha: number;
  readonly standardized: number;
  readonly meanR: number;
  readonly low: number;
  readonly high: number;
  readonly itemVariances: readonly number[];
  readonly totalVariance: number;
  readonly perItem: readonly ItemStats[];
}

const column = (rows: readonly (readonly number[])[], j: number) => rows.map((row) => row[j]);
const totals = (rows: readonly (readonly number[])[]) => rows.map((row) => sum(row));

/** Cronbach's alpha from item variances and the total-score variance (both with n - 1 below). */
export function alphaOf(rows: readonly (readonly number[])[]): number {
  const k = rows[0].length;
  const items = Array.from({ length: k }, (_, j) => variance(column(rows, j)));
  return (k / (k - 1)) * (1 - sum(items) / variance(totals(rows)));
}

/** Spearman-Brown: the reliability of a test m times as long. */
export const spearmanBrown = (r: number, m: number): number => (m * r) / (1 + (m - 1) * r);

/** The length factor that brings reliability r to a target reliability. */
export const lengthFor = (r: number, target: number): number => (target * (1 - r)) / (r * (1 - target));

function checkRows(rows: readonly (readonly number[])[], minItems: number): void {
  if (rows.length < 3) fail('fewRespondents', {}, 'data');
  if (rows[0].length < minItems) fail('fewItems', { low: minItems }, 'data');
}

/** The full reliability report for complete respondent-by-item rows, with an interval at the given level. */
export function reliability(rows: readonly (readonly number[])[], level = 0.95): Reliability {
  checkRows(rows, 2);
  const n = rows.length;
  const k = rows[0].length;
  const itemVariances = Array.from({ length: k }, (_, j) => variance(column(rows, j)));
  const total = totals(rows);
  const totalVariance = variance(total);
  if (totalVariance === 0) fail('noVariation', {}, 'data');
  const alpha = (k / (k - 1)) * (1 - sum(itemVariances) / totalVariance);
  const rs: number[] = [];
  for (let i = 0; i < k; i += 1)
    for (let j = i + 1; j < k; j += 1) rs.push(correlation(column(rows, i), column(rows, j)));
  const meanR = mean(rs);
  const a = 1 - level;
  const [d1, d2] = [n - 1, (n - 1) * (k - 1)];
  const perItem = Array.from({ length: k }, (_, j) => {
    const item = column(rows, j);
    const rest = total.map((t, i) => t - item[i]);
    return {
      mean: mean(item),
      sd: sd(item),
      itemTotal: correlation(item, total),
      itemRest: correlation(item, rest),
      alphaIfDeleted: k > 2 ? alphaOf(rows.map((row) => row.filter((_, c) => c !== j))) : NaN,
    };
  });
  return {
    respondents: n,
    items: k,
    alpha,
    standardized: (k * meanR) / (1 + (k - 1) * meanR),
    meanR,
    low: 1 - (1 - alpha) * fQuantile(1 - a / 2, d1, d2),
    high: 1 - (1 - alpha) * fQuantile(a / 2, d1, d2),
    itemVariances,
    totalVariance,
    perItem,
  };
}

export const isBinary = (rows: readonly (readonly number[])[]): boolean =>
  rows.every((row) => row.every((v) => v === 0 || v === 1));

export interface Kr {
  readonly kr20: number;
  readonly kr21: number;
  readonly sumPq: number;
  readonly totalVariance: number;
  readonly meanTotal: number;
}

/** KR-20 and KR-21 for items scored 0 or 1, with the population variance of total scores as in the original. */
export function kuderRichardson(rows: readonly (readonly number[])[]): Kr {
  checkRows(rows, 2);
  if (!isBinary(rows)) fail('binary', {}, 'data');
  const k = rows[0].length;
  const p = Array.from({ length: k }, (_, j) => mean(column(rows, j)));
  const sumPq = sum(p.map((v) => v * (1 - v)));
  const total = totals(rows);
  const totalVariance = variance(total, true);
  if (totalVariance === 0) fail('noVariation', {}, 'data');
  const m = mean(total);
  return {
    kr20: (k / (k - 1)) * (1 - sumPq / totalVariance),
    kr21: (k / (k - 1)) * (1 - (m * (k - m)) / (k * totalVariance)),
    sumPq,
    totalVariance,
    meanTotal: m,
  };
}

export interface SplitHalf {
  readonly r: number;
  readonly corrected: number;
}

/** The correlation of 2 half-tests and its Spearman-Brown correction to full length. */
export function splitHalf(rows: readonly (readonly number[])[], how: 'oddEven' | 'firstSecond'): SplitHalf {
  checkRows(rows, 2);
  const k = rows[0].length;
  const inFirst = (j: number) => (how === 'oddEven' ? j % 2 === 0 : j < Math.ceil(k / 2));
  const a = rows.map((row) => sum(row.filter((_, j) => inFirst(j))));
  const b = rows.map((row) => sum(row.filter((_, j) => !inFirst(j))));
  const r = correlation(a, b);
  return { r, corrected: spearmanBrown(r, 2) };
}
