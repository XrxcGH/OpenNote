// Plot data for the subject tools: histogram bins by the Freedman-Diaconis or Sturges rule, a Gaussian kernel
// density with Silverman's bandwidth, the empirical distribution function, normal Q-Q points at Blom's positions, box
// plots and step curves. Quantiles, bins, and whiskers come from describe.ts, by the table Statistics tool's methods. Pure:
// numbers in, points out; kit-core's plot turns the points into SVG.
import { boxWhiskers, equalBins, finiteSorted, quantile, sampleSd } from './describe';
import type { Bin, BoxPlot } from './describe';
import { normalQuantile } from './dist';
import { ensure } from '../errors';

export type { Bin, BoxPlot };
export { boxWhiskers, quantile };
export type Point = [number, number];
export type BinRule = 'freedman-diaconis' | 'sturges';

/** The most bins any rule gives, as the table Statistics tool also caps them. */
export const MAX_BINS = 60;

/**
 * How many equal-width bins a rule gives. Freedman-Diaconis uses a width of 2·IQR·n^(-1/3) and falls back to
 * Sturges (⌈log₂ n⌉ + 1) when the quartiles coincide. Between 1 and MAX_BINS.
 */
export function binCount(values: readonly number[], rule: BinRule = 'freedman-diaconis'): number {
  const sorted = finiteSorted(values);
  const n = sorted.length;
  if (n < 2 || sorted[0] === sorted[n - 1]) return 1;
  const sturges = Math.ceil(Math.log2(n)) + 1;
  if (rule === 'sturges') return Math.min(MAX_BINS, sturges);
  const iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25);
  if (iqr <= 0) return Math.min(MAX_BINS, sturges);
  const width = 2 * iqr * n ** (-1 / 3);
  return Math.max(1, Math.min(MAX_BINS, Math.ceil((sorted[n - 1] - sorted[0]) / width)));
}

/** Histogram bins by `rule`; empty for no finite values. */
export const histogramBins = (values: readonly number[], rule: BinRule = 'freedman-diaconis'): Bin[] =>
  equalBins(values, binCount(values, rule));

/** Silverman's rule of thumb: 0.9·min(s, IQR/1.34)·n^(-1/5), or s alone when the quartiles coincide. */
export function silvermanBandwidth(values: readonly number[]): number {
  const sorted = finiteSorted(values);
  const n = sorted.length;
  ensure(n >= 2, 'tooFew', 'values');
  const s = sampleSd(sorted);
  const iqr = (quantile(sorted, 0.75) - quantile(sorted, 0.25)) / 1.34;
  const spread = iqr > 0 ? Math.min(s, iqr) : s;
  ensure(spread > 0, 'domain', 'spread');
  return 0.9 * spread * n ** -0.2;
}

export interface Density {
  bandwidth: number;
  points: Point[];
}

/** A Gaussian kernel density on `count` grid points from three bandwidths below the least value to three above. */
export function kernelDensity(values: readonly number[], bandwidth?: number, count = 128): Density {
  const sorted = finiteSorted(values);
  ensure(sorted.length > 0, 'empty');
  const h = bandwidth ?? silvermanBandwidth(sorted);
  ensure(Number.isFinite(h) && h > 0, 'domain', 'bandwidth');
  ensure(count >= 2 && count <= 4096, 'domain', 'count');
  const lo = sorted[0] - 3 * h;
  const hi = sorted[sorted.length - 1] + 3 * h;
  const scale = 1 / (sorted.length * h * Math.sqrt(2 * Math.PI));
  const points: Point[] = [];
  for (let i = 0; i < count; i += 1) {
    const x = lo + ((hi - lo) * i) / (count - 1);
    let sum = 0;
    for (const v of sorted) sum += Math.exp(-0.5 * ((x - v) / h) ** 2);
    points.push([x, sum * scale]);
  }
  return { bandwidth: h, points };
}

/** The empirical distribution function: each distinct value and the share of values at or below it. */
export function ecdf(values: readonly number[]): Point[] {
  const sorted = finiteSorted(values);
  const n = sorted.length;
  const out: Point[] = [];
  sorted.forEach((v, i) => {
    if (i + 1 < n && sorted[i + 1] === v) return;
    out.push([v, (i + 1) / n]);
  });
  return out;
}

export interface QQ {
  /** (theoretical normal quantile, sample value) for each value, in order. */
  points: Point[];
  /** The reference line through the quartiles: intercept and slope. */
  line: { intercept: number; slope: number };
}

/** Normal Q-Q points at Blom's plotting positions (i − 3/8)/(n + 1/4), with the line through the quartiles. */
export function normalQQ(values: readonly number[]): QQ {
  const sorted = finiteSorted(values);
  const n = sorted.length;
  ensure(n >= 2, 'tooFew', 'values');
  const points = sorted.map((v, i): Point => [normalQuantile((i + 1 - 0.375) / (n + 0.25)), v]);
  const z = normalQuantile(0.75);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const slope = (q3 - q1) / (2 * z);
  return { points, line: { intercept: (q1 + q3) / 2, slope } };
}

/**
 * A right-continuous step curve through (x, y) points sorted by x: flat to the next x, then a jump. `from` starts it
 * at a level before the first point (1 for a survival curve, 0 for a cumulative count).
 */
export function stepCurve(points: readonly Point[], from?: number): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  const out: Point[] = [];
  let level = from;
  for (const [x, y] of sorted) {
    if (level !== undefined) out.push([x, level]);
    out.push([x, y]);
    level = y;
  }
  return out;
}
