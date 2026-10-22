import { describe, expect, it } from 'vitest';
import {
  binomialCdf,
  erf,
  normalCdf,
  normalQuantile,
  probability,
  quantile,
  regression,
  tCdf,
  tQuantile,
} from './probability';

describe('probability', () => {
  it('matches normal table values', () => {
    expect(normalCdf(1.96)).toBeCloseTo(0.9750021048517795, 13);
    expect(normalCdf(-1)).toBeCloseTo(0.15865525393145707, 13);
    expect(normalCdf(-6) / 9.865876450376946e-10).toBeCloseTo(1, 10);
    expect(erf(0.5)).toBeCloseTo(0.5204998778130465, 14);
    expect(normalQuantile(0.975)).toBeCloseTo(1.959963984540054, 12);
    expect(normalQuantile(0.001)).toBeCloseTo(-3.090232306167813, 11);
  });

  it('finds normal areas with shading', () => {
    const between = probability({ kind: 'normal', mean: 100, sd: 15 }, { kind: 'between', a: 85, b: 115 });
    expect(between.probability).toBeCloseTo(0.6826894921370859, 12);
    expect(between.shaded).toHaveLength(1);
    expect(between.steps[0].math).toContain('z₁ = −1');
    const outside = probability({ kind: 'normal', mean: 0, sd: 1 }, { kind: 'outside', a: -1.96, b: 1.96 });
    expect(outside.probability).toBeCloseTo(0.04999579029644087, 12);
    expect(outside.shaded).toHaveLength(2);
  });

  it('matches binomial values', () => {
    expect(binomialCdf(3, 10, 0.5)).toBeCloseTo(0.171875, 14);
    const result = probability({ kind: 'binomial', n: 20, p: 0.3 }, { kind: 'above', a: 10 });
    expect(result.probability).toBeCloseTo(0.04796189733134348, 12);
    expect(result.bars.filter((b) => b.shaded)).toHaveLength(11);
    expect(result.mean).toBe(6);
    expect(quantile({ kind: 'binomial', n: 10, p: 0.5 }, 0.5)).toBe(5);
  });

  it('matches t table values', () => {
    expect(tCdf(2.228, 10)).toBeCloseTo(0.975, 4);
    expect(tCdf(2.570581835636314, 5)).toBeCloseTo(0.975, 12);
    expect(tQuantile(0.975, 5)).toBeCloseTo(2.570581835636314, 10);
    expect(tQuantile(0.95, 30)).toBeCloseTo(1.697260886593957, 10);
    // One degree of freedom is the Cauchy distribution.
    expect(tCdf(1, 1)).toBeCloseTo(0.75, 13);
    expect(probability({ kind: 't', df: 10 }, { kind: 'outside', a: -2.228, b: 2.228 }).probability).toBeCloseTo(
      0.05,
      3,
    );
  });
});

describe('linear regression', () => {
  it('fits the first set of the Anscombe quartet', () => {
    const xs = [10, 8, 13, 9, 11, 14, 6, 4, 12, 7, 5];
    const ys = [8.04, 6.95, 7.58, 8.81, 8.33, 9.96, 7.24, 4.26, 10.84, 4.82, 5.68];
    const fit = regression(xs.map((x, i) => ({ x, y: ys[i] })));
    expect(fit.slope).toBeCloseTo(0.5000909090909091, 12);
    expect(fit.intercept).toBeCloseTo(3.0000909090909103, 12);
    expect(fit.r2).toBeCloseTo(0.666542459508775, 12);
    expect(fit.r).toBeCloseTo(0.8164205163448399, 12);
    expect(fit.slopeError).toBeCloseTo(0.11790550059563408, 10);
  });

  it('fits a perfect line and refuses one point', () => {
    const fit = regression([0, 1, 2, 3].map((x) => ({ x, y: 2 * x + 1 })));
    expect(fit.slope).toBeCloseTo(2, 14);
    expect(fit.r2).toBeCloseTo(1, 14);
    expect(() => regression([{ x: 1, y: 2 }])).toThrow('regression-points');
  });
});
