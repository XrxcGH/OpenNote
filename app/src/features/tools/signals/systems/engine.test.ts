// Discrete systems and sampling: each validation case from first principles, plus the edge cases the tool names.
import { describe, expect, it } from 'vitest';
import { SignalError } from '../shared/errors';
import {
  aliased,
  changeRate,
  convolve,
  convolveContinuous,
  crossCorrelate,
  impulse,
  quantize,
  runDifference,
  sampleAndRebuild,
  sqnrTheory,
  unitStep,
} from './engine';

describe('convolution', () => {
  it('convolves 1, 2, 3 with 0, 1, 0.5 to 0, 1, 2.5, 4, 1.5', () => {
    const result = convolve([1, 2, 3], [0, 1, 0.5]);
    [0, 1, 2.5, 4, 1.5].forEach((v, i) => expect(result.y[i]).toBeCloseTo(v, 12));
    expect(result.rows[2]!.terms).toEqual([
      { k: 0, x: 1, h: 0.5 },
      { k: 1, x: 2, h: 1 },
      { k: 2, x: 3, h: 0 },
    ]);
  });

  it('keeps the starting indices', () => {
    const result = convolve([1, 1], [1, 1], -1, 2);
    expect(result.start).toBe(1);
    expect(result.rows.map((row) => row.n)).toEqual([1, 2, 3]);
  });

  it('refuses an empty sequence', () => {
    expect(() => convolve([], [1])).toThrow(SignalError);
  });
});

describe('correlation', () => {
  it('finds a delay of 3 samples at the peak', () => {
    const x = [0.2, 1, -0.5, 0.8, 0.1, -1, 0.3];
    const delayed = [0, 0, 0, ...x];
    expect(crossCorrelate(x, delayed).peakLag).toBe(3);
  });

  it('peaks at lag 0 for a signal with itself', () => {
    expect(crossCorrelate([1, 2, 1], [1, 2, 1]).peakLag).toBe(0);
  });
});

describe('difference equations', () => {
  it('gives h[n] = 0.5^n for y[n] = 0.5 y[n−1] + x[n]', () => {
    const result = runDifference([1], [1, -0.5], impulse(4));
    [1, 0.5, 0.25, 0.125].forEach((v, n) => expect(result.y[n]).toBeCloseTo(v, 12));
    expect(result.poles[0]!.re).toBeCloseTo(0.5, 12);
    expect(result.stable).toBe(true);
  });

  it('calls a pole outside the unit circle unstable, and steps toward 1/(1 − 0.5) = 2', () => {
    expect(runDifference([1], [1, -1.5], impulse(3)).stable).toBe(false);
    expect(runDifference([1], [1, -0.5], unitStep(60)).y[59]).toBeCloseTo(2, 9);
  });

  it('refuses a zero leading coefficient', () => {
    expect(() => runDifference([1], [0, 1], impulse(3))).toThrow(SignalError);
  });
});

describe('sampling and quantization', () => {
  it('shows a 7 kHz tone sampled at 10 kHz at 3 kHz', () => {
    const result = aliased(7000, 10000);
    expect(result.apparent).toBe(3000);
    expect(result.aliases).toBe(true);
    expect(aliased(2000, 10000).apparent).toBe(2000);
  });

  it('gives an SQNR of 98.08 dB for a full-scale sine at 16 bits', () => {
    expect(sqnrTheory(16)).toBeCloseTo(98.08, 9);
  });

  it('measures close to the theory for 8 bits, and refuses 0 bits', () => {
    const result = quantize(8, 1);
    expect(Math.abs(result.measured - result.theory)).toBeLessThan(1);
    expect(result.stepSize).toBeCloseTo(2 / 256, 12);
    expect(() => quantize(0, 1)).toThrow(SignalError);
  });

  it('rebuilds a slow tone by sinc interpolation through the samples', () => {
    const rebuilt = sampleAndRebuild(1, 20, 1, 10);
    rebuilt.samples.forEach((v, n) => expect(rebuilt.sinc[n * 10]).toBeCloseTo(v, 9));
    expect(rebuilt.hold[5]).toBe(rebuilt.samples[0]);
  });

  it('inserts zeros to upsample and keeps every M-th sample to downsample', () => {
    expect(changeRate([1, 2, 3], 2, 1).y).toEqual([1, 0, 2, 0, 3, 0]);
    expect(changeRate([1, 2, 3, 4, 5], 1, 2).y).toEqual([1, 3, 5]);
    expect(() => changeRate([1], 0, 1)).toThrow(SignalError);
  });
});

describe('continuous convolution', () => {
  it('turns two unit rectangles of width 1 into a triangle of height 1 at t = 1', () => {
    const rect = { kind: 'rect', at: 0, size: 1, height: 1 } as const;
    const result = convolveContinuous(rect, rect, 200);
    const peak = result.y.indexOf(Math.max(...result.y));
    expect(result.t[peak]).toBeCloseTo(1, 6);
    expect(result.y[peak]).toBeCloseTo(1, 3);
    expect(result.y[50]).toBeCloseTo(0.5, 3);
  });

  it('matches (1 − e^(−t)) for a unit step with e^(−t)', () => {
    const result = convolveContinuous(
      { kind: 'exponential', at: 0, size: 1, height: 1 },
      { kind: 'step', at: 0, size: 1, height: 1 },
      100,
    );
    const i = result.t.findIndex((time) => time >= 2);
    expect(result.y[i]).toBeCloseTo(1 - Math.exp(-result.t[i]!), 3);
  });
});
