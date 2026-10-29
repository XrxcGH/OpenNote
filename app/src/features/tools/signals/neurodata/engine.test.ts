// Neural and physiological time series. The plan's validation cases come first, with their independent expected
// values (hand calculations or signals built to have the answer); edge cases follow.
import { describe, expect, it } from 'vitest';
import { gaussian, seededRandom } from '../shared/num';
import { SignalError } from '../shared/errors';
import {
  correlations,
  epochAverage,
  glm,
  hrfPeak,
  hrv,
  kernelRate,
  lombScargle,
  peakIn,
  rPeaks,
  regressor,
  snrGain,
  spikeStats,
} from './engine';

const errorKey = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof SignalError ? error.key : 'other';
  }
  return 'none';
};

describe('fMRI', () => {
  it('peaks the canonical HRF at 4.998 s', () => {
    expect(Math.abs(hrfPeak() - 4.998)).toBeLessThan(0.01);
  });

  it('fits a boxcar regressor equal to the data plus a constant with beta 1 and no residual', () => {
    const box = Array.from({ length: 40 }, (_, i) => (Math.floor(i / 10) % 2 ? 1 : 0));
    const fit = glm([box, Array<number>(40).fill(1)], box, [1, 0]);
    expect(fit.beta[0]).toBeCloseTo(1, 9);
    expect(fit.beta[1]).toBeCloseTo(0, 9);
    for (const r of fit.residuals) expect(Math.abs(r)).toBeLessThan(1e-9);
    expect(errorKey(() => glm([box, box], box, [1, 0]))).toBe('collinear');
  });

  it('makes a block regressor that rises after its onset and correlates fully with itself', () => {
    const reg = regressor([10], [20], 2, 30);
    expect(reg[2]!).toBeLessThan(reg[10]!);
    expect(correlations([reg, reg])[0]![1]).toBeCloseTo(1, 12);
  });
});

describe('event-related averages', () => {
  it('improves the signal-to-noise ratio by 10 with 100 trials', () => {
    expect(snrGain(100)).toBe(10);
    // Measured: the standard error of an average of 100 unit-noise trials is about 1/10.
    const normal = gaussian(seededRandom(5));
    const fs = 100;
    const events = Array.from({ length: 100 }, (_, k) => 50 + k * 60);
    const x = Array.from({ length: 6200 }, () => normal());
    const avg = epochAverage(x, fs, events, 0.1, 0.3, Infinity);
    const se = avg.se.reduce((a, b) => a + b, 0) / avg.se.length;
    expect(se).toBeGreaterThan(0.08);
    expect(se).toBeLessThan(0.12);
  });

  it('rejects epochs over the threshold and finds a peak and its latency', () => {
    const fs = 100;
    const x = Array<number>(1000).fill(0);
    const events = [100, 300, 500, 700];
    for (const e of events) x[e + 30] = 5;
    x[730] = 500;
    const avg = epochAverage(x, fs, events, 0.1, 0.5, 100);
    expect(avg.rejected).toBe(1);
    const peak = peakIn(avg.t, avg.average, 0.2, 0.4, 'positive');
    expect(peak.amplitude).toBeCloseTo(5, 12);
    expect(peak.latency).toBeCloseTo(0.3, 12);
    expect(errorKey(() => epochAverage(x, fs, [100], 0.1, 0.5, 100))).toBe('fewEpochs');
  });
});

describe('spikes and heart rate', () => {
  it('gives ISIs 10, 12, 8, 10 ms a rate of 100 spikes/s and a CV of 0.141421', () => {
    const times = [0, 0.01, 0.022, 0.03, 0.04];
    const stats = spikeStats([times], 0.05, 0.01);
    expect(stats.rate).toBeCloseTo(100, 9);
    expect(Math.abs(stats.cv - 0.141421)).toBeLessThan(1e-6);
    expect(errorKey(() => spikeStats([[]], 1, 0.1))).toBe('noSpikes');
  });

  it('smooths spikes into a rate whose integral is the spike count', () => {
    const { t, rate } = kernelRate([[0.5]], 1, 0.05, 1001);
    const area = rate.reduce((a, r) => a + r, 0) * (t[1]! - t[0]!);
    expect(area).toBeCloseTo(1, 3);
  });

  it('gives RR 800, 810, 790, 805, 795 ms an SDNN of 7.90569, an RMSSD of 14.3614, and 75 bpm', () => {
    const result = hrv([800, 810, 790, 805, 795]);
    expect(Math.abs(result.sdnn - 7.90569)).toBeLessThan(1e-5);
    expect(Math.abs(result.rmssd - 14.3614)).toBeLessThan(1e-4);
    expect(result.hr).toBeCloseTo(75, 9);
    expect(errorKey(() => hrv([800]))).toBe('rrIntervals');
  });

  it('puts a 0.25 Hz rhythm in the HF band of the Lomb-Scargle spectrum', () => {
    const times = Array.from({ length: 120 }, (_, i) => i * 0.8 + 0.05 * Math.sin(i));
    const values = times.map((t) => 800 + 20 * Math.sin(2 * Math.PI * 0.25 * t));
    const { lf, hf } = lombScargle(times, values);
    expect(hf).toBeGreaterThan(10 * lf);
  });

  it('finds one R peak per beat in a synthetic ECG at 72 bpm', () => {
    const fs = 250;
    const beat = Math.round((60 / 72) * fs);
    const ecg = Array.from({ length: fs * 10 }, (_, i) => {
      const k = i % beat;
      return Math.exp(-(((k - 20) / 3) ** 2)) + 0.1 * Math.sin((2 * Math.PI * i) / beat);
    });
    const peaks = rPeaks(ecg, fs);
    expect(peaks.length).toBeGreaterThanOrEqual(11);
    expect(peaks.length).toBeLessThanOrEqual(12);
    peaks.forEach((p) => expect(Math.abs((p % beat) - 20)).toBeLessThanOrEqual(2));
  });
});
