// Time series against values worked out separately. The 24-month series checks r1, r2, Ljung-Box, simple smoothing,
// and Yule-Walker. The Mann-Kendall case checks S, Z, p, and Sen's slope. Small cases worked by hand check
// differencing, decomposition, Holt's method, ψ weights, and the accuracy measures. Seeded simulations check that
// the fitted ARIMA coefficients and the simulated Dickey-Fuller quantiles land near their known values.
import { describe, expect, it } from 'vitest';
import { firstTexts, runTool } from '../kit/read';
import { makeRng } from '../kit/rng';
import { StatError } from '../kit/types';
import { acf, adf, decompose, difference, ljungBox, mannKendall, movingAverage, pacf, periodogram } from './engine';
import { accuracy, arimaForecast, fitArima, psiWeights, smooth, yuleWalker } from './models';
import { timeseriesSpec } from './spec';

const close = (got: number, want: number, tol: number) => expect(Math.abs(got - want)).toBeLessThanOrEqual(tol);
const code = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    return e instanceof StatError ? e.code : 'other';
  }
  return 'none';
};

const monthly = [
  112, 118, 132, 129, 121, 135, 148, 148, 136, 119, 104, 118, 115, 126, 141, 135, 125, 149, 170, 170, 158, 133, 114,
  140,
];
const none = { alpha: NaN, beta: NaN, gamma: NaN };

describe('autocorrelation', () => {
  it('finds r1 and r2 of the 24-month series', () => {
    const r = acf(monthly, 2);
    close(r[0], 0.623679, 1e-6);
    close(r[1], 0.150632, 1e-6);
  });

  it('runs the Ljung-Box test over 6 lags', () => {
    const lb = ljungBox(monthly, 6);
    close(lb.q, 13.4009, 1e-4);
    close(lb.p, 0.037093, 1e-5);
    expect(lb.df).toBe(6);
  });

  it('gives partial autocorrelations of an AR(1) pattern', () => {
    const p = pacf([0.5, 0.25, 0.125]);
    close(p[0], 0.5, 1e-12);
    close(p[1], 0, 1e-12);
    close(p[2], 0, 1e-12);
  });
});

describe('transformations and decomposition', () => {
  it('differences and averages', () => {
    expect(difference([1, 4, 9, 16])).toEqual([3, 5, 7]);
    expect(difference([1, 4, 9, 16], 1, 2)).toEqual([2, 2]);
    expect(difference([1, 2, 3, 4, 5], 2)).toEqual([2, 2, 2]);
    const ma = movingAverage([0, 1, 2, 3, 4, 5, 6, 7], 4);
    expect(ma.slice(2, 6)).toEqual([2, 3, 4, 5]);
    expect(Number.isNaN(ma[0])).toBe(true);
  });

  it('recovers exact seasonal indices from a line plus a season', () => {
    const s = [1, -1, 2, -2];
    const x = Array.from({ length: 16 }, (_, t) => 10 + 0.5 * t + s[t % 4]);
    const d = decompose(x, 4, false);
    d.indices.forEach((v, i) => close(v, s[i], 1e-12));
    close(d.trend[5], 12.5, 1e-12);
  });
});

describe('exponential smoothing', () => {
  it('forecasts the 24-month series by simple smoothing with α = 0.3', () => {
    const s = smooth(monthly, 'ses', { ...none, alpha: 0.3 }, 12, 1, 0.95);
    close(s.forecast[0], 138.3885, 1e-4);
  });

  it("follows Holt's method by hand", () => {
    const s = smooth([1, 3, 4], 'holt', { alpha: 0.5, beta: 0.5, gamma: NaN }, 1, 2, 0.95);
    close(s.forecast[0], 6.25, 1e-12);
    close(s.forecast[1], 8, 1e-12);
  });

  it('chooses α by least squares when it is left blank', () => {
    const s = smooth(monthly, 'ses', none, 12, 3, 0.95);
    expect(s.estimated).toEqual(['alpha']);
    const sse = (a: number) => smooth(monthly, 'ses', { ...none, alpha: a }, 12, 1, 0.95).sse;
    expect(s.sse).toBeLessThanOrEqual(sse(Math.min(0.9999, s.params.alpha + 0.01)) + 1e-9);
    expect(s.sse).toBeLessThanOrEqual(sse(Math.max(0.0001, s.params.alpha - 0.01)) + 1e-9);
  });

  it('runs Holt-Winters on 2 years of months', () => {
    const add = smooth(monthly, 'hwadd', none, 12, 12, 0.95);
    expect(add.forecast).toHaveLength(12);
    expect(add.low[0]).toBeLessThan(add.forecast[0]);
    const mult = smooth(monthly, 'hwmult', none, 12, 12, 0.95);
    expect(Number.isFinite(mult.forecast[11])).toBe(true);
  });
});

describe('ARIMA', () => {
  it('adds a drift to a once-differenced model only when asked', () => {
    // A random walk with drift: with ARIMA(0, 1, 0) and a constant, the CSS drift is the mean difference,
    // (y_n - y_1) / (n - 1), and the h-step forecast is y_n + h times it.
    const rng = makeRng(7);
    const y = [10];
    for (let t = 1; t < 40; t++) y.push(y[t - 1] + 1.07 + (rng.next() - 0.5));
    const n = y.length;
    const slope = (y[n - 1] - y[0]) / (n - 1);
    const withDrift = fitArima(y, 0, 1, 0, 'css', true);
    close(withDrift.mean, slope, 1e-6);
    const f = arimaForecast(y, withDrift, 3, 0.95).forecast;
    [1, 2, 3].forEach((h) => close(f[h - 1], y[n - 1] + h * slope, 1e-5));
    const flat = arimaForecast(y, fitArima(y, 0, 1, 0, 'css'), 3, 0.95).forecast;
    flat.forEach((v) => close(v, y[n - 1], 1e-12));
  });

  it('says on screen whether a differenced model has a drift', () => {
    const rows = Array.from({ length: 30 }, (_, t) => `${t},${(1.07 * t + Math.sin(t)).toFixed(3)}`);
    const data = ['month,sales', ...rows].join('\n');
    const texts = { ...firstTexts(timeseriesSpec), data, analysis: 'arima', p: '1', d: '1', q: '0' };
    const keys = (drift: string) => {
      const run = runTool(timeseriesSpec, { ...texts, drift });
      if (!run.ok) throw new Error('the ARIMA run failed');
      return run.outcome.steps.map((s) => s.key);
    };
    expect(keys('noDrift')).toContain('timeseries.noDrift');
    expect(keys('withDrift')).toContain('timeseries.drift');
  });

  it('fits AR(1) by Yule-Walker with φ = r1', () => {
    close(yuleWalker(monthly, 1).phi[0], 0.623679, 1e-6);
    close(fitArima(monthly, 1, 0, 0, 'yw').phi[0], 0.623679, 1e-6);
  });

  it('recovers simulated AR(1) and MA(1) coefficients', () => {
    const rng = makeRng(11);
    const e = Array.from({ length: 601 }, () => rng.normal());
    const ar: number[] = [0];
    for (let t = 1; t < 600; t++) ar.push(0.6 * ar[t - 1] + e[t]);
    close(fitArima(ar, 1, 0, 0, 'css').phi[0], 0.6, 0.08);
    const ma = e.slice(1).map((v, t) => v + 0.5 * e[t]);
    close(fitArima(ma, 0, 0, 1, 'css').theta[0], 0.5, 0.1);
  });

  it('forecasts a random walk by its last value with growing intervals', () => {
    expect(psiWeights([0.5], [], 0, 4)).toEqual([1, 0.5, 0.25, 0.125]);
    expect(psiWeights([], [], 1, 3)).toEqual([1, 1, 1]);
    const walk = [5, 6, 4, 7, 8, 7, 9, 10, 9, 11];
    const fit = fitArima(walk, 0, 1, 0, 'css');
    const f = arimaForecast(walk, fit, 3, 0.95);
    f.forecast.forEach((v) => close(v, 11 + fit.mean * 0, 1e-12));
    close((f.high[1] - f.forecast[1]) / (f.high[0] - f.forecast[0]), Math.SQRT2, 1e-9);
  });

  it('scores forecasts on a hold-out', () => {
    const a = accuracy([1, 2, 3, 4], [5, 7], [5, 6], 1);
    close(a.mae, 0.5, 1e-12);
    close(a.rmse, Math.sqrt(0.5), 1e-12);
    close(a.mape, (100 * (1 / 7)) / 2, 1e-12);
    close(a.mase, 0.5, 1e-12);
  });
});

describe('trend tests', () => {
  it("runs Mann-Kendall and Sen's slope", () => {
    const mk = mannKendall([5.1, 5.3, 5.2, 5.8, 6.0, 5.9, 6.4, 6.6, 6.5, 7.0]);
    expect(mk.s).toBe(39);
    close(mk.z, 3.3988, 1e-4);
    close(mk.p, 0.0006768, 1e-4);
    close(mk.sen, 0.2, 1e-4);
  });

  it('simulates Dickey-Fuller quantiles near the published ones', () => {
    const rng = makeRng(5);
    const noise = Array.from({ length: 100 }, () => rng.normal());
    const r = adf(noise, 0, 'drift', 2000, 3);
    close(r.critical.p05, -2.89, 0.15);
    expect(r.tau).toBeLessThan(r.critical.p01);
    const again = adf(noise, 0, 'drift', 2000, 3);
    expect(again.critical).toEqual(r.critical);
  });
});

describe('impossible series input', () => {
  it('says why a series cannot be analyzed', () => {
    expect(code(() => acf([3, 3, 3, 3], 2))).toBe('constantSeries');
    expect(code(() => mannKendall([1, 2]))).toBe('shortSeries');
    expect(code(() => decompose(monthly, 1, false))).toBe('periodTooSmall');
    expect(code(() => decompose(monthly.slice(0, 10), 12, false))).toBe('shortSeries');
    expect(code(() => decompose([1, -2, 3, 4, 5, 6], 2, true))).toBe('logPositive');
    expect(code(() => smooth(monthly, 'ses', { ...none, alpha: 1.5 }, 12, 1, 0.95))).toBe('smoothingRange');
    expect(code(() => fitArima(monthly, 1, 0, 1, 'yw'))).toBe('arOnly');
    expect(code(() => ljungBox(monthly, 2, 2))).toBe('lagsTooFew');
    expect(code(() => fitArima([1, 2, 3], 1, 0, 0, 'css'))).toBe('shortSeries');
  });
});

describe('periodogram', () => {
  it('peaks at the frequency of a cosine with power n / 4', () => {
    // x_t = cos(2π 3 t / 24): the sum at j = 3 is n / 2, so I = (n / 2)^2 / n = n / 4 = 6; elsewhere it is 0.
    const n = 24;
    const x = Array.from({ length: n }, (_, t) => Math.cos((2 * Math.PI * 3 * t) / n));
    const p = periodogram(x);
    expect(p).toHaveLength(12);
    close(p[2].freq, 3 / 24, 1e-15);
    close(p[2].power, 6, 1e-9);
    p.filter((_, i) => i !== 2).forEach((q) => close(q.power, 0, 1e-9));
  });

  it('adds up to the sum of squares (Parseval)', () => {
    // Over j = 1 to n − 1, I(j / n) sums to sum (x − x̄)^2; with n odd the upper half mirrors the lower.
    const x = [3, 1, 4, 1, 5, 9, 2];
    const m = x.reduce((s, v) => s + v, 0) / x.length;
    const ss = x.reduce((s, v) => s + (v - m) ** 2, 0);
    const half = periodogram(x).reduce((s, q) => s + q.power, 0);
    close(2 * half, ss, 1e-9);
  });

  it('is 0 for a constant series and refuses a short one', () => {
    periodogram([2, 2, 2, 2, 2]).forEach((q) => expect(q.power).toBe(0));
    expect(() => periodogram([1, 2, 3])).toThrow();
  });
});
