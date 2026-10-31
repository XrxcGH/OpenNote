// Spectral analysis: each validation case from first principles, plus the edge cases the tool names.
import { describe, expect, it } from 'vitest';
import { fft, fft2, ifft, makeWindow, windowFigures } from '../shared/fft';
import { SignalError } from '../shared/errors';
import { seededRandom } from '../shared/num';
import { bandPowers, detrend, halfPowerDamping, halfPowerPoints, peaks, spectrogram, spectrum, welch } from './engine';

const sine = (n: number, f: number, fs: number, a = 1) =>
  Array.from({ length: n }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / fs));

describe('discrete Fourier transform', () => {
  it('transforms 1, 2, 3, 4 to 10, −2+2i, −2, −2−2i', () => {
    const X = fft([1, 2, 3, 4]);
    const expected = [
      [10, 0],
      [-2, 2],
      [-2, 0],
      [-2, -2],
    ];
    expected.forEach(([re, im], k) => {
      expect(X.re[k]).toBeCloseTo(re!, 12);
      expect(X.im[k]).toBeCloseTo(im!, 12);
    });
  });

  it('agrees with the direct sum at lengths that are not powers of two', () => {
    const random = seededRandom(7);
    for (const n of [3, 5, 6, 7, 12, 31, 100]) {
      const x = Array.from({ length: n }, () => random() - 0.5);
      const X = fft(x);
      for (let k = 0; k < n; k += 1) {
        let re = 0;
        let im = 0;
        x.forEach((v, j) => {
          re += v * Math.cos((-2 * Math.PI * k * j) / n);
          im += v * Math.sin((-2 * Math.PI * k * j) / n);
        });
        expect(X.re[k]).toBeCloseTo(re, 10);
        expect(X.im[k]).toBeCloseTo(im, 10);
      }
    }
  });

  it('inverts back to the samples, in one and two dimensions', () => {
    const x = [3, -1, 4, 1, -5, 9];
    const X = fft(x);
    const back = ifft(X.re, X.im);
    x.forEach((v, i) => expect(back.re[i]).toBeCloseTo(v, 12));
    const grid = Float64Array.from([1, 2, 3, 4, 5, 6]);
    const F = fft2(grid, new Float64Array(6), 3, 2);
    expect(F.re[0]).toBeCloseTo(21, 12);
    const inverse = fft2(F.re, F.im, 3, 2, true);
    grid.forEach((v, i) => expect(inverse.re[i]).toBeCloseTo(v, 12));
  });

  it('refuses an empty record', () => {
    expect(() => fft([])).toThrow(SignalError);
  });
});

describe('one-sided spectra', () => {
  it('reads amplitude 1 at 1 kHz for a unit sine sampled at 8 kHz, eight points, rectangular', () => {
    const result = spectrum({ samples: sine(8, 1000, 8000), rate: 8000, window: 'rectangular', detrend: 'none' });
    expect(result.freq[1]).toBe(1000);
    expect(result.amplitude[1]).toBeCloseTo(1, 12);
    [0, 2, 3, 4].forEach((k) => expect(result.amplitude[k]).toBeCloseTo(0, 12));
    expect(result.power[1]).toBeCloseTo(0.5, 12);
  });

  it('has an equivalent noise bandwidth of 1.5 bins for a periodic Hann window of 1024 points', () => {
    expect(windowFigures(makeWindow('hann', 1024)).enbw).toBeCloseTo(1.5, 6);
    expect(windowFigures(makeWindow('rectangular', 64)).enbw).toBe(1);
  });

  it('keeps Parseval: the sum of squares equals the spectrum sum over N', () => {
    const random = seededRandom(3);
    const samples = Array.from({ length: 300 }, () => random() * 2 - 1);
    for (const window of ['rectangular', 'hann', 'flattop'] as const) {
      const result = spectrum({ samples, rate: 100, window, detrend: 'mean' });
      expect(Math.abs(result.parseval.time - result.parseval.frequency)).toBeLessThan(1e-9);
    }
  });

  it('corrects the amplitude for the window, so a Hann-windowed sine on a bin still reads its amplitude', () => {
    const result = spectrum({ samples: sine(256, 32, 256, 3), rate: 256, window: 'hann', detrend: 'none' });
    expect(result.amplitude[32]).toBeCloseTo(3, 9);
  });

  it('integrates the density to the mean square of the signal', () => {
    const samples = sine(1000, 50, 1000, 2);
    const result = spectrum({ samples, rate: 1000, window: 'rectangular', detrend: 'none' });
    const total = result.psd.reduce((s, p) => s + p * result.binWidth, 0);
    expect(total).toBeCloseTo(2, 9);
  });

  it('removes a mean and a line', () => {
    expect(detrend([1, 2, 3], 'mean')).toEqual([-1, 0, 1]);
    detrend([2, 4, 6, 8], 'linear').forEach((v) => expect(v).toBeCloseTo(0, 12));
  });

  it('says what is wrong with too few samples, a bad rate, or numbers that are not finite', () => {
    const base = { rate: 10, window: 'hann', detrend: 'none' } as const;
    expect(() => spectrum({ ...base, samples: [1] })).toThrow(SignalError);
    expect(() => spectrum({ ...base, samples: [1, 2], rate: 0 })).toThrow(SignalError);
    expect(() => spectrum({ ...base, samples: [1, Number.NaN] })).toThrow(SignalError);
  });
});

describe('averaged and time-frequency spectra', () => {
  it('averages segments in Welch’s method and keeps the total power of a sine', () => {
    const samples = sine(4096, 50, 1000, 1);
    const result = welch({ samples, rate: 1000, window: 'hann', detrend: 'none', segment: 512, overlap: 0.5 });
    expect(result.segments).toBe(15);
    const df = result.freq[1]! - result.freq[0]!;
    const total = result.psd.reduce((s, p) => s + p * df, 0);
    expect(total).toBeCloseTo(0.5, 2);
  });

  it('builds a spectrogram whose loudest row follows a tone', () => {
    const samples = sine(2048, 100, 1000);
    const result = spectrogram({ samples, rate: 1000, window: 'hann', detrend: 'none', segment: 200, overlap: 0.5 });
    expect(result.rows.length).toBe(101);
    const column = result.rows.map((row) => row[3]!);
    expect(column.indexOf(Math.max(...column))).toBe(20);
  });

  it('refuses a segment longer than the record or an overlap past 95%', () => {
    const base = { samples: sine(64, 1, 64), rate: 64, window: 'hann', detrend: 'none' } as const;
    expect(() => welch({ ...base, segment: 100, overlap: 0.5 })).toThrow(SignalError);
    expect(() => welch({ ...base, segment: 32, overlap: 0.99 })).toThrow(SignalError);
  });
});

describe('bands, peaks, and damping', () => {
  it('puts a 10 Hz rhythm in the alpha band', () => {
    const samples = sine(1000, 10, 100);
    const result = spectrum({ samples, rate: 100, window: 'rectangular', detrend: 'none' });
    const bands = bandPowers(result.freq, result.psd, [
      { name: 'theta', low: 4, high: 8 },
      { name: 'alpha', low: 8, high: 13 },
    ]);
    expect(bands[1]!.relative).toBeCloseTo(1, 9);
    expect(bands[0]!.power).toBeCloseTo(0, 9);
  });

  it('finds the two tones of a mix, largest first', () => {
    const samples = sine(1000, 50, 1000, 1).map((v, i) => v + 0.5 * Math.sin((2 * Math.PI * 120 * i) / 1000));
    const result = spectrum({ samples, rate: 1000, window: 'rectangular', detrend: 'none' });
    const found = peaks(result.freq, result.amplitude, 2);
    expect(found[0]!.freq).toBeCloseTo(50, 6);
    expect(found[1]!.freq).toBeCloseTo(120, 6);
  });

  it('places a Gaussian peak exactly and reads an off-bin Hann tone to within 2% of a bin', () => {
    // A Gaussian is a parabola on a log scale, so three bins of exp(−(f − 10.37)²/2) put the vertex at 10.37.
    const freq = Array.from({ length: 21 }, (_, k) => k);
    const [gauss] = peaks(
      freq,
      freq.map((f) => Math.exp(-((f - 10.37) ** 2) / 2)),
      1,
    );
    expect(gauss!.freq).toBeCloseTo(10.37, 12);
    // 1024 samples at 1 kHz: bins 0.9765625 Hz apart, the tone 0.7072 of a bin past bin 102. A parabola through
    // linear magnitudes reads 100.351 Hz here (about 5% of a bin high); the log-scale parabola is within 2%.
    const samples = sine(1024, 100.3, 1000, 1);
    const result = spectrum({ samples, rate: 1000, window: 'hann', detrend: 'none' });
    const [top] = peaks(result.freq, result.amplitude, 1);
    expect(result.freq[1]).toBeCloseTo(0.9765625, 12);
    expect(Math.abs(top!.freq - 100.3)).toBeLessThan(0.02 * 0.9765625);
  });

  it('gives a damping ratio of 0.02 from half-power points at 9.8 and 10.2 Hz around 10 Hz', () => {
    expect(halfPowerDamping(9.8, 10.2, 10).zeta).toBeCloseTo(0.02, 9);
    expect(() => halfPowerDamping(10.2, 9.8, 10)).toThrow(SignalError);
  });

  it('reads the half-power points of a resonance curve', () => {
    const fn = 10;
    const zeta = 0.02;
    const freq = Float64Array.from({ length: 2001 }, (_, i) => 5 + i * 0.005);
    const magnitude = freq.map((f) => 1 / Math.hypot(1 - (f / fn) ** 2, 2 * zeta * (f / fn)));
    const [f1, f2, peak] = halfPowerPoints(freq, magnitude);
    expect(halfPowerDamping(f1, f2, peak).zeta).toBeCloseTo(zeta, 3);
  });
});
