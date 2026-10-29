// Describing a time series and testing it for trend. The sample autocorrelation is
// r_k = sum (x_t − x̄)(x_{t+k} − x̄) / sum (x_t − x̄)^2, the partial autocorrelation comes from the Durbin-Levinson
// recursion, and the Ljung-Box statistic is Q = n(n + 2) sum r_k^2 / (n − k). Classical decomposition takes a
// centered moving average as the trend. The Mann-Kendall test counts rising and falling pairs, and Sen's slope is
// the median pairwise slope. The augmented Dickey-Fuller statistic is compared with quantiles simulated from seeded
// random walks of the same length, not copied from a table.
import { chiSquareUpper, normalTwoSided } from '../kit/dist';
import { leastSquares, mean, median } from '../kit/linalg';
import { makeRng } from '../kit/rng';
import { fail } from '../kit/types';

const sum = (xs: readonly number[]) => xs.reduce((s, v) => s + v, 0);

export function checkSeries(x: readonly number[], least: number): void {
  if (x.length < least) fail('shortSeries', String(least));
}

/** r_1 to r_maxLag. */
export function acf(x: readonly number[], maxLag: number): number[] {
  const n = x.length;
  const m = mean(x);
  const d = x.map((v) => v - m);
  const c0 = sum(d.map((v) => v * v));
  if (!(c0 > 0)) fail('constantSeries');
  return Array.from({ length: Math.min(maxLag, n - 1) }, (_, k) => {
    let s = 0;
    for (let t = 0; t + k + 1 < n; t++) s += d[t] * d[t + k + 1];
    return s / c0;
  });
}

/** The partial autocorrelations from the autocorrelations, by the Durbin-Levinson recursion. */
export function pacf(r: readonly number[]): number[] {
  const out: number[] = [];
  let phi: number[] = [];
  for (let k = 1; k <= r.length; k++) {
    let num = r[k - 1];
    let den = 1;
    for (let j = 1; j < k; j++) {
      num -= phi[j - 1] * r[k - j - 1];
      den -= phi[j - 1] * r[j - 1];
    }
    const kk = num / den;
    phi = [...phi.map((p, j) => p - kk * phi[k - j - 2]), kk];
    out.push(kk);
  }
  return out;
}

/** Ljung-Box Q over the first `lags` autocorrelations, on lags − fitted degrees of freedom. */
export function ljungBox(x: readonly number[], lags: number, fitted = 0) {
  const n = x.length;
  const r = acf(x, lags);
  const q = n * (n + 2) * sum(r.map((v, k) => (v * v) / (n - k - 1)));
  const df = r.length - fitted;
  if (df < 1) fail('lagsTooFew');
  return { q, df, p: chiSquareUpper(q, df) };
}

/** Differences of order d at a lag (1 for ordinary, the period for seasonal). */
export function difference(x: readonly number[], lag = 1, d = 1): number[] {
  let out = [...x];
  for (let k = 0; k < d; k++) out = out.slice(lag).map((v, i) => v - out[i]);
  return out;
}

/** A centered moving average; for an even window it averages 2 neighboring averages (the 2 × m average). */
export function movingAverage(x: readonly number[], m: number): number[] {
  const n = x.length;
  const out = new Array<number>(n).fill(NaN);
  if (m % 2 === 1) {
    const h = (m - 1) / 2;
    for (let t = h; t < n - h; t++) out[t] = mean(x.slice(t - h, t + h + 1));
  } else {
    const h = m / 2;
    for (let t = h; t < n - h; t++) {
      let s = 0.5 * x[t - h] + 0.5 * x[t + h];
      for (let j = t - h + 1; j < t + h; j++) s += x[j];
      out[t] = s / m;
    }
  }
  return out;
}

export interface Decomposition {
  readonly trend: number[];
  readonly seasonal: number[];
  readonly remainder: number[];
  readonly indices: number[];
}

/** Classical decomposition: trend by the centered moving average, then seasonal indices from the detrended values. */
export function decompose(x: readonly number[], period: number, multiplicative: boolean): Decomposition {
  if (!(period >= 2)) fail('periodTooSmall');
  if (x.length < 2 * period) fail('shortSeries', String(2 * period));
  if (multiplicative && x.some((v) => v <= 0)) fail('logPositive', 'the series');
  const trend = movingAverage(x, period);
  const detrended = x.map((v, t) => (multiplicative ? v / trend[t] : v - trend[t]));
  const raw = Array.from({ length: period }, (_, s) => {
    const vals = detrended.filter((v, t) => t % period === s && Number.isFinite(v));
    return mean(vals);
  });
  const centre = mean(raw);
  const indices = raw.map((v) => (multiplicative ? v / centre : v - centre));
  const seasonal = x.map((_, t) => indices[t % period]);
  const remainder = x.map((v, t) => (multiplicative ? v / (trend[t] * seasonal[t]) : v - trend[t] - seasonal[t]));
  return { trend, seasonal, remainder, indices };
}

export interface MannKendall {
  readonly s: number;
  readonly variance: number;
  readonly z: number;
  readonly p: number;
  readonly tau: number;
  readonly sen: number;
  readonly senIntercept: number;
}

/** The Mann-Kendall trend test with the tie correction, and Sen's slope. */
export function mannKendall(x: readonly number[]): MannKendall {
  const n = x.length;
  if (n < 3) fail('shortSeries', '3');
  let s = 0;
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++)
    for (let j = i + 1; j < n; j++) {
      s += Math.sign(x[j] - x[i]);
      slopes.push((x[j] - x[i]) / (j - i));
    }
  const ties = new Map<number, number>();
  for (const v of x) ties.set(v, (ties.get(v) ?? 0) + 1);
  let tieTerm = 0;
  for (const t of ties.values()) tieTerm += t * (t - 1) * (2 * t + 5);
  const variance = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18;
  const z = s === 0 ? 0 : (s - Math.sign(s)) / Math.sqrt(variance);
  const sen = median(slopes);
  const senIntercept = median(x.map((v, t) => v - sen * t));
  return { s, variance, z, p: normalTwoSided(z), tau: s / ((n * (n - 1)) / 2), sen, senIntercept };
}

export type AdfKind = 'none' | 'drift' | 'trend';

/** τ = γ̂ / SE(γ̂) in Δx_t = [α + βt] + γ x_{t−1} + sum δ_i Δx_{t−i} + e. */
export function adfStatistic(
  x: readonly number[],
  lags: number,
  kind: AdfKind,
): { tau: number; gamma: number; n: number } {
  const dx = difference(x);
  const rows: number[][] = [];
  const ys: number[] = [];
  for (let t = lags; t < dx.length; t++) {
    const row: number[] = [];
    if (kind !== 'none') row.push(1);
    if (kind === 'trend') row.push(t + 1);
    row.push(x[t]);
    for (let i = 1; i <= lags; i++) row.push(dx[t - i]);
    rows.push(row);
    ys.push(dx[t]);
  }
  const p = rows[0]?.length ?? 0;
  if (rows.length <= p + 1) fail('shortSeries', String(p + lags + 3));
  const ls = leastSquares(rows, ys);
  const at = kind === 'none' ? 0 : kind === 'drift' ? 1 : 2;
  const s2 = ls.rss / (rows.length - p);
  const se = Math.sqrt(s2 * ls.xtxInv[at][at]);
  return { tau: ls.coef[at] / se, gamma: ls.coef[at], n: rows.length };
}

export interface Adf {
  readonly tau: number;
  readonly gamma: number;
  readonly critical: { readonly p01: number; readonly p05: number; readonly p10: number };
  readonly p: number;
  readonly sims: number;
}

/** The ADF statistic and its 1%, 5%, and 10% critical values and p-value from seeded random walks under a unit root. */
export function adf(x: readonly number[], lags: number, kind: AdfKind, sims: number, seed: number): Adf {
  const { tau, gamma } = adfStatistic(x, lags, kind);
  const rng = makeRng(seed);
  const taus: number[] = [];
  for (let s = 0; s < sims; s++) {
    const walk = new Array<number>(x.length);
    walk[0] = 0;
    for (let t = 1; t < x.length; t++) walk[t] = walk[t - 1] + rng.normal();
    try {
      taus.push(adfStatistic(walk, lags, kind).tau);
    } catch {
      // A degenerate simulated path is skipped.
    }
  }
  taus.sort((a, b) => a - b);
  const q = (p: number) => taus[Math.min(taus.length - 1, Math.max(0, Math.floor(p * taus.length)))];
  const below = taus.filter((t) => t <= tau).length;
  return {
    tau,
    gamma,
    critical: { p01: q(0.01), p05: q(0.05), p10: q(0.1) },
    p: (below + 1) / (taus.length + 1),
    sims: taus.length,
  };
}
