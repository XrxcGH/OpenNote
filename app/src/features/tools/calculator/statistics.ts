// The statistics calculator: a list of numbers, or pairs of x and y on lines of their own, as typed or pasted from a
// table. A list gives the count, sum, mean, median, mode, spread, and quartiles; pairs also give the least-squares
// line and how well it fits. Quartiles interpolate between values, as a spreadsheet's QUARTILE.INC does. Answers are
// snapped to 15 digits, like the rest of the calculator.
import { snap } from '../../../core/expr';

export interface Data {
  xs: number[];
  /** Present when every line held a pair. */
  ys?: number[];
}

export type DataResult = { ok: true; data: Data } | { ok: false; error: 'empty' | 'not-a-number'; text: string };

/** The most numbers read, so a huge paste cannot stall the window. */
export const MAX_VALUES = 100_000;
const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;

/** Reads the numbers. Commas, spaces, tabs, and semicolons separate them; two per line on every line makes pairs. */
export function readData(text: string): DataResult {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const split = (line: string) => line.split(/[\s,;]+/).filter((piece) => piece !== '');
  const rows = lines.map(split);
  const all = rows.flat();
  if (all.length === 0) return { ok: false, error: 'empty', text: '' };
  const bad = all.find((piece) => !NUMBER.test(piece));
  if (bad !== undefined) return { ok: false, error: 'not-a-number', text: bad };
  const numbers = all.slice(0, MAX_VALUES).map(Number);
  if (rows.length > 1 && rows.every((row) => row.length === 2)) {
    return {
      ok: true,
      data: { xs: rows.map((row) => Number(row[0])), ys: rows.map((row) => Number(row[1])) },
    };
  }
  return { ok: true, data: { xs: numbers } };
}

export interface Summary {
  count: number;
  sum: number;
  mean: number;
  median: number;
  /** The values that appear most often, or none when no value repeats. */
  modes: number[];
  min: number;
  max: number;
  range: number;
  q1: number;
  q3: number;
  iqr: number;
  /** With n - 1 in the divisor. NaN for one value. */
  sampleVariance: number;
  sampleSd: number;
  populationVariance: number;
  populationSd: number;
}

/** The value at fraction `p` of the sorted values, interpolating between neighbors. */
export function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const at = (sorted.length - 1) * p;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}

/** The summary of a list. The mean and the spread use a two-pass sum, which keeps large values exact enough. */
export function summarize(values: readonly number[]): Summary | null {
  const n = values.length;
  if (n === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((total, v) => total + v, 0);
  const mean = sum / n;
  const squares = values.reduce((total, v) => total + (v - mean) ** 2, 0);
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const most = Math.max(...counts.values());
  const modes =
    most > 1
      ? [...counts]
          .filter(([, c]) => c === most)
          .map(([v]) => v)
          .sort((a, b) => a - b)
      : [];
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const sampleVariance = n > 1 ? squares / (n - 1) : NaN;
  const populationVariance = squares / n;
  return {
    count: n,
    sum: snap(sum),
    mean: snap(mean),
    median: snap(quantile(sorted, 0.5)),
    modes,
    min: sorted[0],
    max: sorted[n - 1],
    range: snap(sorted[n - 1] - sorted[0]),
    q1: snap(q1),
    q3: snap(q3),
    iqr: snap(q3 - q1),
    sampleVariance: snap(sampleVariance),
    sampleSd: snap(Math.sqrt(sampleVariance)),
    populationVariance: snap(populationVariance),
    populationSd: snap(Math.sqrt(populationVariance)),
  };
}

export interface Regression {
  slope: number;
  intercept: number;
  /** Pearson's correlation coefficient. */
  r: number;
  r2: number;
}

/** The least-squares line y = slope x + intercept, or null for fewer than two points or x that never changes. */
export function regress(xs: readonly number[], ys: readonly number[]): Regression | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const r = syy === 0 ? 1 : sxy / Math.sqrt(sxx * syy);
  return { slope: snap(slope), intercept: snap(my - slope * mx), r: snap(r), r2: snap(r * r) };
}
