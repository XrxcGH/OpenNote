import { describe, expect, it } from 'vitest';
import {
  asFraction,
  determinant,
  eigenvalues,
  inverse,
  multiply,
  rankOf,
  reduce,
  solveSystem,
  transpose,
} from './linalg';
import { equationOf, exponentialFit, polynomialFit } from './regression';
import { boxPlot, histogram, quantile, summarize } from './stats';

const close = (a: number, b: number, digits = 8) => expect(a).toBeCloseTo(b, digits);

describe('statistics', () => {
  it('summarizes a list', () => {
    const s = summarize([2, 4, 4, 4, 5, 5, 7, 9])!;
    expect(s.count).toBe(8);
    expect(s.sum).toBe(40);
    expect(s.mean).toBe(5);
    expect(s.median).toBe(4.5);
    expect(s.mode).toEqual([4]);
    close(s.stdevPop, 2);
    close(s.variancePop, 4);
    close(s.stdev, Math.sqrt(32 / 7));
    expect([s.min, s.max, s.q1, s.q3]).toEqual([2, 9, 4, 5.5]);
  });

  it('has no mode when nothing repeats, and no sample spread for one value', () => {
    expect(summarize([1, 2, 3])!.mode).toEqual([]);
    const one = summarize([3])!;
    expect(one.stdev).toBeNaN();
    expect(one.stdevPop).toBe(0);
    expect(summarize([])).toBeNull();
  });

  it('interpolates quantiles', () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });

  it('bins values with the top edge in the last bin', () => {
    const bins = histogram([1, 2, 2, 3, 3, 3, 4, 10], 3);
    expect(bins.map((b) => b.count)).toEqual([6, 1, 1]);
    expect(bins[2].to).toBe(10);
    expect(histogram([5, 5]).length).toBe(1);
    expect(histogram([])).toEqual([]);
  });

  it('finds whiskers and outliers', () => {
    const box = boxPlot([1, 2, 3, 4, 5, 6, 7, 8, 9, 100])!;
    expect(box.outliers).toEqual([100]);
    expect(box.highWhisker).toBe(9);
    expect(box.median).toBe(5.5);
  });
});

describe('regression', () => {
  it('fits a line exactly', () => {
    const fit = polynomialFit([1, 2, 3, 4], [3, 5, 7, 9], 1)!;
    close(fit.coefficients[0], 1);
    close(fit.coefficients[1], 2);
    close(fit.r2, 1);
    expect(equationOf(fit, (v) => String(Math.round(v * 1e6) / 1e6))).toBe('y = 2x + 1');
  });

  it('fits a parabola with far-from-zero x', () => {
    const xs = [1000, 1001, 1002, 1003, 1004];
    const ys = xs.map((x) => 0.5 * x * x - 3 * x + 2);
    const fit = polynomialFit(xs, ys, 2)!;
    close(fit.coefficients[2], 0.5, 6);
    close(fit.r2, 1, 6);
    close(fit.predict(1005), 0.5 * 1005 * 1005 - 3 * 1005 + 2, 3);
  });

  it('measures a poor fit', () => {
    const fit = polynomialFit([1, 2, 3, 4, 5], [1, 5, 2, 6, 3], 1)!;
    expect(fit.r2).toBeGreaterThan(0);
    expect(fit.r2).toBeLessThan(0.5);
  });

  it('fits an exponential and refuses non-positive y', () => {
    const xs = [0, 1, 2, 3];
    const fit = exponentialFit(
      xs,
      xs.map((x) => 2 * Math.exp(0.5 * x)),
    )!;
    close(fit.coefficients[0], 2);
    close(fit.coefficients[1], 0.5);
    close(fit.r2, 1);
    expect(exponentialFit([0, 1], [1, 0])).toBeNull();
  });

  it('needs more points than the degree', () => {
    expect(polynomialFit([1, 2], [1, 2], 2)).toBeNull();
    expect(polynomialFit([1, 1, 1], [1, 2, 3], 1)).toBeNull();
  });

  it('writes a negative leading term and a missing term', () => {
    const fit = { kind: 'polynomial' as const, coefficients: [3, 0, -1], degree: 2, r2: 1, n: 3, predict: () => 0 };
    expect(equationOf(fit, String)).toBe('y = −x² + 3');
  });
});

describe('matrices', () => {
  const a = [
    [2, 1],
    [5, 3],
  ];

  it('computes determinant, inverse, transpose, and product', () => {
    close(determinant(a), 1);
    expect(inverse(a)).toEqual([
      [3, -1],
      [-5, 2],
    ]);
    expect(transpose([[1, 2, 3]])).toEqual([[1], [2], [3]]);
    expect(multiply(a, inverse(a)!)).toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(multiply([[1, 2]], [[1, 2]])).toBeNull();
    expect(
      inverse([
        [1, 2],
        [2, 4],
      ]),
    ).toBeNull();
    close(
      determinant([
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 10],
      ]),
      -3,
    );
  });

  it('row reduces with steps and finds the rank', () => {
    const { result, steps, pivots } = reduce([
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ]);
    expect(result).toEqual([
      [1, 0, -1],
      [0, 1, 2],
      [0, 0, 0],
    ]);
    expect(pivots).toEqual([0, 1]);
    expect(steps.length).toBeGreaterThan(2);
    expect(steps[steps.length - 1].matrix).toEqual(result);
    expect(
      rankOf([
        [1, 2],
        [2, 4],
      ]),
    ).toBe(1);
  });

  it('solves systems of every kind', () => {
    const unique = solveSystem([
      [2, 1, 5],
      [1, -1, 1],
    ]);
    expect(unique.kind).toBe('unique');
    if (unique.kind === 'unique') {
      close(unique.x[0], 2);
      close(unique.x[1], 1);
    }
    expect(
      solveSystem([
        [1, 1, 2],
        [1, 1, 3],
      ]).kind,
    ).toBe('none');
    expect(
      solveSystem([
        [1, 1, 2],
        [2, 2, 4],
      ]).kind,
    ).toBe('infinite');
  });

  it('finds real eigenvalues and counts complex ones', () => {
    const real = eigenvalues([
      [2, 0],
      [0, 3],
    ]);
    expect(real.real.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([2, 3]);
    const twice = eigenvalues([
      [2, 1],
      [0, 2],
    ]);
    expect(twice.real.length).toBe(2);
    close(twice.real[0], 2, 5);
    const rotation = eigenvalues([
      [0, -1],
      [1, 0],
    ]);
    expect(rotation).toEqual({ real: [], complex: 2 });
    const three = eigenvalues([
      [2, -1, 0],
      [-1, 2, -1],
      [0, -1, 2],
    ]);
    close(three.real[0], 2 - Math.SQRT2, 6);
    close(three.real[2], 2 + Math.SQRT2, 6);
  });

  it('writes small fractions', () => {
    expect(asFraction(0.5)).toEqual({ n: 1, d: 2 });
    expect(asFraction(-4)).toEqual({ n: -4, d: 1 });
    expect(asFraction(1 / 3)).toEqual({ n: 1, d: 3 });
    expect(asFraction(Math.PI)).toBeNull();
  });
});
