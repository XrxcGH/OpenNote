// The filter designer. The plan's validation cases come first, with their independent expected values (hand
// calculations); edge cases and physical checks follow.
import { describe, expect, it } from 'vitest';
import { SignalError } from '../shared/errors';
import { cabs } from '../shared/num';
import { filtfilt, frequencyResponse, impulseAndStep, lfilter, medianFilter, polesZeros } from './apply';
import {
  firWindow,
  groupDelay,
  iirBilinear,
  iirImpulseInvariant,
  kaiserEstimate,
  movingAverage,
  notch,
  quantizeCoefficients,
  response,
} from './design';

const gainAt = (b: number[], a: number[], f: number, fs: number) => cabs(response(b, a, (2 * Math.PI * f) / fs));
const db = (g: number) => 20 * Math.log10(g);
const errorKey = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof SignalError ? error.key : 'other';
  }
  return 'none';
};

describe('IIR designs', () => {
  it('gives the order-2 Butterworth lowpass at 1 kHz, fs 8 kHz, its textbook coefficients and −3.0103 dB at the edge', () => {
    // K = tan(π/8): b0 = K²/(1 + √2 K + K²), a1 = 2(K² − 1)/(…), a2 = (1 − √2 K + K²)/(…).
    const { b, a } = iirBilinear('butterworth', 'lowpass', 2, 1000, 0, 8000);
    [0.0976311, 0.195262, 0.0976311].forEach((v, i) => expect(Math.abs(b[i]! - v)).toBeLessThan(1e-6));
    [1, -0.942809, 0.333333].forEach((v, i) => expect(Math.abs(a[i]! - v)).toBeLessThan(1e-6));
    expect(Math.abs(gainAt(b, a, 1000, 8000) - Math.SQRT1_2)).toBeLessThan(1e-6);
  });

  it('puts the order-3 Chebyshev I (1 dB ripple) at exactly −1 dB at its edge, 0.3 of Nyquist', () => {
    const { b, a } = iirBilinear('chebyshev1', 'lowpass', 3, 0.15 * 8000, 0, 8000, 1);
    expect(Math.abs(db(gainAt(b, a, 1200, 8000)) + 1)).toBeLessThan(1e-6);
    // An odd order has unit gain at DC; an even one starts at the bottom of the ripple.
    expect(gainAt(b, a, 0, 8000)).toBeCloseTo(1, 9);
    const even = iirBilinear('chebyshev1', 'lowpass', 4, 1200, 0, 8000, 1);
    expect(db(gainAt(even.b, even.a, 0, 8000))).toBeCloseTo(-1, 9);
  });

  it('puts a Chebyshev II stopband edge at the asked attenuation', () => {
    const { b, a } = iirBilinear('chebyshev2', 'lowpass', 4, 1000, 0, 8000, 1, 40);
    expect(db(gainAt(b, a, 1000, 8000))).toBeCloseTo(-40, 6);
    expect(gainAt(b, a, 0, 8000)).toBeCloseTo(1, 9);
  });

  it('gives highpass, bandpass, and bandstop Butterworths −3 dB at every edge', () => {
    const hp = iirBilinear('butterworth', 'highpass', 3, 500, 0, 8000);
    expect(db(gainAt(hp.b, hp.a, 500, 8000))).toBeCloseTo(-3.0103, 4);
    expect(gainAt(hp.b, hp.a, 4000, 8000)).toBeCloseTo(1, 9);
    const bp = iirBilinear('butterworth', 'bandpass', 2, 800, 1600, 8000);
    expect(db(gainAt(bp.b, bp.a, 800, 8000))).toBeCloseTo(-3.0103, 4);
    expect(db(gainAt(bp.b, bp.a, 1600, 8000))).toBeCloseTo(-3.0103, 4);
    const bs = iirBilinear('butterworth', 'bandstop', 2, 800, 1600, 8000);
    expect(db(gainAt(bs.b, bs.a, 800, 8000))).toBeCloseTo(-3.0103, 4);
    expect(gainAt(bs.b, bs.a, 0, 8000)).toBeCloseTo(1, 9);
  });

  it('keeps every pole inside the unit circle and matches the sections to the whole', () => {
    const filter = iirBilinear('chebyshev1', 'bandpass', 4, 1000, 2000, 10000, 0.5);
    expect(polesZeros(filter.b, filter.a).poles.every((p) => cabs(p) < 1)).toBe(true);
    const product = filter.sos!.reduce((g, s) => g * cabs(response(s.slice(0, 3), s.slice(3), 0.9)), 1);
    expect(product).toBeCloseTo(cabs(response(filter.b, filter.a, 0.9)), 9);
  });

  it('samples the analog impulse response by impulse invariance: a first-order pole at e^(−ωc T)', () => {
    const { b, a } = iirImpulseInvariant('butterworth', 1, 100, 1000);
    expect(a[1]).toBeCloseTo(-Math.exp((-2 * Math.PI * 100) / 1000), 12);
    expect(b[0]).toBeCloseTo((2 * Math.PI * 100) / 1000, 12);
  });

  it('refuses an edge above Nyquist, an order of 0, and band edges out of order', () => {
    expect(errorKey(() => iirBilinear('butterworth', 'lowpass', 2, 5000, 0, 8000))).toBe('cutoff');
    expect(errorKey(() => iirBilinear('butterworth', 'lowpass', 0, 1000, 0, 8000))).toBe('order');
    expect(errorKey(() => iirBilinear('butterworth', 'bandpass', 2, 1600, 800, 8000))).toBe('bandEdges');
  });
});

describe('FIR designs', () => {
  it('gives a 21-tap Hamming lowpass at 0.25 of Nyquist a center tap of 0.248999 and 10 samples of delay', () => {
    const { b } = firWindow('lowpass', 21, 0.125 * 8000, 0, 8000, 'hamming');
    expect(Math.abs(b[10]! - 0.248999)).toBeLessThan(1e-6);
    expect(b.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 12);
    expect(Math.abs(groupDelay(b, [1], 0.3) - 10)).toBeLessThan(1e-6);
  });

  it('estimates 147 taps and β = 5.65326 for 60 dB with a transition of 0.05 of Nyquist', () => {
    const estimate = kaiserEstimate(60, 0.05);
    expect(estimate.taps).toBe(147);
    expect(Math.abs(estimate.beta - 5.65326)).toBeLessThan(1e-6);
  });

  it('gives unit gain where each band type passes, and needs odd taps for highpass', () => {
    const hp = firWindow('highpass', 51, 1000, 0, 8000, 'hann');
    expect(gainAt(hp.b, [1], 4000, 8000)).toBeCloseTo(1, 9);
    const bp = firWindow('bandpass', 51, 1000, 2000, 8000, 'blackman');
    expect(gainAt(bp.b, [1], 1500, 8000)).toBeCloseTo(1, 9);
    expect(errorKey(() => firWindow('highpass', 50, 1000, 0, 8000, 'hann'))).toBe('oddTaps');
    expect(errorKey(() => firWindow('lowpass', 2, 1000, 0, 8000, 'hann'))).toBe('taps');
  });

  it('makes a differentiator whose gain rises with frequency and a Hilbert transformer with a 90° shift', () => {
    const d = firWindow('differentiator', 31, 0, 0, 8000, 'hamming');
    const w = 0.2;
    expect(cabs(response(d.b, [1], w))).toBeCloseTo(w, 2);
    const h = firWindow('hilbert', 31, 0, 0, 8000, 'hamming');
    const r = frequencyResponse(h.b, [1], 8000, 101);
    // Remove the linear phase of 15 samples; what remains is −90°.
    const k = 50;
    const linear = (-15 * Math.PI * k) / 100;
    expect(((r.phase[k]! * Math.PI) / 180 - linear) % (2 * Math.PI)).toBeCloseTo(-Math.PI / 2, 2);
  });
});

describe('simple filters and running them', () => {
  it('averages with unit DC gain and nulls the notch frequency', () => {
    const ma = movingAverage(5);
    expect(gainAt(ma.b, ma.a, 0, 1000)).toBeCloseTo(1, 12);
    const n = notch(60, 4, 1000);
    expect(gainAt(n.b, n.a, 60, 1000)).toBeLessThan(1e-12);
    expect(gainAt(n.b, n.a, 0, 1000)).toBeCloseTo(1, 12);
    expect(errorKey(() => movingAverage(0))).toBe('taps');
  });

  it('runs y[n] = 0.5 y[n−1] + x[n] as 1, 0.5, 0.25 and steps toward 2', () => {
    expect(lfilter([1], [1, -0.5], [1, 0, 0])).toEqual([1, 0.5, 0.25]);
    const { step } = impulseAndStep([1], [1, -0.5], 60);
    expect(step[59]).toBeCloseTo(2, 9);
  });

  it('filters forward and backward with no phase shift in the passband', () => {
    const { b, a } = iirBilinear('butterworth', 'lowpass', 4, 50, 0, 1000);
    const x = Array.from({ length: 1000 }, (_, n) => Math.sin((2 * Math.PI * 5 * n) / 1000));
    const y = filtfilt(b, a, x);
    // At 5 Hz the gain is 1 to within 1e-9 twice over, and the peak stays where it was.
    for (let n = 200; n < 800; n += 1) expect(Math.abs(y[n]! - x[n]!)).toBeLessThan(1e-4);
    expect(errorKey(() => filtfilt(b, a, [1, 2, 3]))).toBe('tooFewSamples');
  });

  it('removes a spike with a median filter', () => {
    expect(medianFilter([1, 1, 9, 1, 1], 3)).toEqual([1, 1, 1, 1, 1]);
    expect(errorKey(() => medianFilter([1, 2], 2))).toBe('medianWindow');
  });

  it('keeps a filter close at 16 bits and moves it at 4', () => {
    const { b, a } = iirBilinear('butterworth', 'lowpass', 2, 1000, 0, 8000);
    const q16 = { b: quantizeCoefficients(b, 16).values, a: quantizeCoefficients(a, 16).values };
    expect(Math.abs(gainAt(q16.b, q16.a, 1000, 8000) - Math.SQRT1_2)).toBeLessThan(1e-3);
    const q4 = quantizeCoefficients(b, 4).values;
    expect(q4.some((v, i) => Math.abs(v - b[i]!) > 1e-3)).toBe(true);
    expect(errorKey(() => quantizeCoefficients(b, 1))).toBe('coefficientBits');
  });
});
