// Descriptive statistics for the numbers in a table (Statistics tool). Pure: numbers in, numbers out.

export interface Summary {
  count: number;
  sum: number;
  mean: number;
  median: number;
  /** Every value that occurs most often, ascending. Empty when no value repeats. */
  mode: number[];
  /** Sample standard deviation and variance (n - 1). NaN with fewer than two values. */
  stdev: number;
  variance: number;
  /** Population standard deviation and variance (n). */
  stdevPop: number;
  variancePop: number;
  min: number;
  max: number;
  q1: number;
  q3: number;
}

/** A quantile by linear interpolation between ranks (the inclusive method of the QUARTILE.INC spreadsheet function). */
export function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const at = (sorted.length - 1) * p;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}

export function summarize(values: readonly number[]): Summary | null {
  const data = values.filter((value) => Number.isFinite(value));
  if (data.length === 0) return null;
  const sorted = [...data].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((total, value) => total + value, 0);
  const mean = sum / n;
  const squares = sorted.reduce((total, value) => total + (value - mean) ** 2, 0);
  const counts = new Map<number, number>();
  for (const value of sorted) counts.set(value, (counts.get(value) ?? 0) + 1);
  const most = Math.max(...counts.values());
  const mode = most > 1 ? [...counts].filter(([, times]) => times === most).map(([value]) => value) : [];
  return {
    count: n,
    sum,
    mean,
    median: quantile(sorted, 0.5),
    mode,
    stdev: n > 1 ? Math.sqrt(squares / (n - 1)) : NaN,
    variance: n > 1 ? squares / (n - 1) : NaN,
    stdevPop: Math.sqrt(squares / n),
    variancePop: squares / n,
    min: sorted[0],
    max: sorted[n - 1],
    q1: quantile(sorted, 0.25),
    q3: quantile(sorted, 0.75),
  };
}

export interface Bin {
  from: number;
  to: number;
  count: number;
}

/** Equal-width bins, their number by Sturges' rule unless given. The last bin includes its upper edge. */
export function histogram(values: readonly number[], binCount?: number): Bin[] {
  const data = values.filter((value) => Number.isFinite(value));
  if (data.length === 0) return [];
  const min = Math.min(...data);
  const max = Math.max(...data);
  if (min === max) return [{ from: min, to: max, count: data.length }];
  const k = Math.max(1, Math.min(60, binCount ?? Math.ceil(Math.log2(data.length)) + 1));
  const width = (max - min) / k;
  const bins: Bin[] = Array.from({ length: k }, (_, i) => ({
    from: min + i * width,
    to: i === k - 1 ? max : min + (i + 1) * width,
    count: 0,
  }));
  for (const value of data) bins[Math.min(k - 1, Math.floor((value - min) / width))].count++;
  return bins;
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

export function boxPlot(values: readonly number[]): BoxPlot | null {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const inside = sorted.filter((value) => value >= q1 - 1.5 * iqr && value <= q3 + 1.5 * iqr);
  return {
    min: sorted[0],
    q1,
    median: quantile(sorted, 0.5),
    q3,
    max: sorted[sorted.length - 1],
    iqr,
    lowWhisker: inside[0],
    highWhisker: inside[inside.length - 1],
    outliers: sorted.filter((value) => value < q1 - 1.5 * iqr || value > q3 + 1.5 * iqr),
  };
}
