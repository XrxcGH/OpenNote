import { describe, expect, it } from 'vitest';
import { SubjectError } from '../errors';
import { normalCdf } from './dist';
import {
  binCount,
  boxWhiskers,
  ecdf,
  histogramBins,
  kernelDensity,
  normalQQ,
  silvermanBandwidth,
  stepCurve,
} from './plots';

const oneToHundred = Array.from({ length: 100 }, (_, i) => i + 1);

describe('plot data', () => {
  it('counts bins by Freedman-Diaconis and by Sturges', () => {
    // 1..100: IQR 75.25 − 25.75 = 49.5, width 99/100^(1/3) = 21.33, so ⌈99/21.33⌉ = 5; Sturges ⌈log₂100⌉ + 1 = 8.
    expect(binCount(oneToHundred)).toBe(5);
    expect(binCount(oneToHundred, 'sturges')).toBe(8);
    expect(histogramBins(oneToHundred).reduce((s, b) => s + b.count, 0)).toBe(100);
    // Coinciding quartiles fall back to Sturges: ⌈log₂6⌉ + 1 = 4.
    expect(binCount([1, 1, 1, 1, 1, 9])).toBe(4);
    expect(binCount([5, 5, 5])).toBe(1);
    expect(binCount([])).toBe(1);
    expect(histogramBins([])).toEqual([]);
  });

  it('takes Silverman’s bandwidth by hand and builds a density that integrates to one', () => {
    // 1..5: s = √2.5, IQR/1.34 = 2/1.34; 0.9 · 1.492537 · 5^(−0.2) = 0.973585.
    expect(silvermanBandwidth([1, 2, 3, 4, 5])).toBeCloseTo(0.973585, 5);
    const { points } = kernelDensity([1, 2, 3, 4, 5], undefined, 400);
    let area = 0;
    for (let i = 1; i < points.length; i += 1)
      area += ((points[i][0] - points[i - 1][0]) * (points[i][1] + points[i - 1][1])) / 2;
    // The end values lose the 0.135% of their kernel beyond three bandwidths; the inner ones almost nothing.
    expect(area).toBeCloseTo((2 * (1 - 0.00135) + 3) / 5, 3);
    const single = kernelDensity([2], 0.5, 3);
    expect(single.points[1]).toEqual([2, expect.closeTo(1 / (0.5 * Math.sqrt(2 * Math.PI)), 12)]);
  });

  it('steps the empirical distribution at each distinct value', () => {
    expect(ecdf([3, 1, 2, 2, Number.NaN])).toEqual([
      [1, 0.25],
      [2, 0.75],
      [3, 1],
    ]);
    expect(ecdf([])).toEqual([]);
  });

  it('places Q-Q points at Blom positions with the line through the quartiles', () => {
    const { points, line } = normalQQ([30, 10, 20]);
    expect(points.map((p) => p[1])).toEqual([10, 20, 30]);
    expect(normalCdf(points[0][0])).toBeCloseTo(0.625 / 3.25, 12);
    expect(points[1][0]).toBeCloseTo(0, 12);
    expect(points[2][0]).toBeCloseTo(-points[0][0], 12);
    // Quartiles 15 and 25 against ±0.6744897502.
    expect(line.intercept).toBe(20);
    expect(line.slope).toBeCloseTo(10 / (2 * 0.6744897502), 8);
  });

  it('marks outliers beyond 1.5 IQR and draws step curves', () => {
    const box = boxWhiskers([1, 2, 3, 4, 100]);
    expect(box?.outliers).toEqual([100]);
    expect(box?.highWhisker).toBe(4);
    expect(boxWhiskers([])).toBeNull();
    expect(
      stepCurve(
        [
          [2, 0.5],
          [1, 0.8],
        ],
        1,
      ),
    ).toEqual([
      [1, 1],
      [1, 0.8],
      [2, 0.8],
      [2, 0.5],
    ]);
  });

  it('refuses too few values, no spread, and a bad bandwidth', () => {
    expect(() => silvermanBandwidth([1])).toThrow(SubjectError);
    expect(() => silvermanBandwidth([2, 2, 2])).toThrow(SubjectError);
    expect(() => kernelDensity([], 1)).toThrow(SubjectError);
    expect(() => kernelDensity([1, 2], -1)).toThrow(SubjectError);
    expect(() => normalQQ([1])).toThrow(SubjectError);
  });
});
