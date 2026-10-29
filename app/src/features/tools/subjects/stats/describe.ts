// The descriptive numbers the subject plots need: the inclusive quantile, the sample standard deviation, equal-width
// bins, and box-plot whiskers. They use the same methods as the table Statistics tool (tables/analysis/stats), so a
// plot here and a chart of the same table agree. They are copied rather than imported, since that module is internal
// to the tables feature and its public index does not export it.

export interface Bin {
  from: number;
  to: number;
  count: number;
}

export interface BoxPlot {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  iqr: number;
  /** The most extreme values within 1.5 IQR of the box. */
  lowWhisker: number;
  highWhisker: number;
  outliers: number[];
}

/** The finite values, ascending. */
export const finiteSorted = (values: readonly number[]): number[] =>
  values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);

/** A quantile of sorted values by linear interpolation between ranks (the spreadsheet QUARTILE.INC method). */
export function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const at = (sorted.length - 1) * p;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}

/** The sample standard deviation (n − 1); NaN with fewer than two values. */
export function sampleSd(values: readonly number[]): number {
  const data = values.filter((v) => Number.isFinite(v));
  const n = data.length;
  if (n < 2) return Number.NaN;
  const mean = data.reduce((s, v) => s + v, 0) / n;
  return Math.sqrt(data.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
}

/** `count` equal-width bins over the finite values. The last bin includes its upper edge. */
export function equalBins(values: readonly number[], count: number): Bin[] {
  const data = finiteSorted(values);
  if (data.length === 0) return [];
  const min = data[0];
  const max = data[data.length - 1];
  if (min === max) return [{ from: min, to: max, count: data.length }];
  const k = Math.max(1, Math.round(count));
  const width = (max - min) / k;
  const bins: Bin[] = Array.from({ length: k }, (_, i) => ({
    from: min + i * width,
    to: i === k - 1 ? max : min + (i + 1) * width,
    count: 0,
  }));
  for (const v of data) bins[Math.min(k - 1, Math.floor((v - min) / width))].count += 1;
  return bins;
}

/** Box-plot numbers with whiskers at the most extreme values within 1.5 IQR; null for no finite values. */
export function boxWhiskers(values: readonly number[]): BoxPlot | null {
  const sorted = finiteSorted(values);
  if (sorted.length === 0) return null;
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const inside = sorted.filter((v) => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr);
  return {
    min: sorted[0],
    q1,
    median: quantile(sorted, 0.5),
    q3,
    max: sorted[sorted.length - 1],
    iqr,
    lowWhisker: inside[0],
    highWhisker: inside[inside.length - 1],
    outliers: sorted.filter((v) => v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr),
  };
}
