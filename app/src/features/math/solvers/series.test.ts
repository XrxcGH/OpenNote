import { describe, expect, it } from 'vitest';
import { taylor } from './series';

describe('Taylor series', () => {
  it('expands sin about 0', () => {
    const result = taylor({ f: 'sin(x)', center: 0, order: 7, at: 1, from: -4, to: 4 });
    const want = [0, 1, 0, -1 / 6, 0, 1 / 120, 0, -1 / 5040];
    result.coefficients.forEach((c, k) => expect(c).toBeCloseTo(want[k], 14));
    expect(result.polynomial).toBe('x − x^3/6 + x^5/120 − x^7/5040');
    expect(result.remainder!.actual).toBeLessThanOrEqual(result.remainder!.bound);
    expect(result.remainder!.bound).toBeCloseTo(Math.sin(1) / 40320, 12);
    expect(result.graph.partials).toHaveLength(7);
  });

  it('expands exp about 0 and about 1', () => {
    const zero = taylor({ f: 'exp(x)', center: 0, order: 5, from: -2, to: 2 });
    zero.coefficients.forEach((c, k) => expect(c).toBeCloseTo(1 / [1, 1, 2, 6, 24, 120][k], 14));
    const one = taylor({ f: 'e^x', center: 1, order: 3, at: 1.5, from: 0, to: 2 });
    one.coefficients.forEach((c, k) => expect(c).toBeCloseTo(Math.E / [1, 1, 2, 6][k], 12));
    expect(one.polynomial.startsWith('2.718281828')).toBe(true);
    // The fourth derivative is e^x, largest at x = 1.5.
    expect(one.remainder!.bound).toBeCloseTo((Math.exp(1.5) * 0.5 ** 4) / 24, 4);
    expect(one.remainder!.actual).toBeLessThan(one.remainder!.bound);
  });

  it('expands ln(1 + x) with alternating coefficients', () => {
    const result = taylor({ f: 'ln(1 + x)', center: 0, order: 6, at: 0.5, from: -0.9, to: 2 });
    result.coefficients.forEach((c, k) => expect(c).toBeCloseTo(k === 0 ? 0 : (-1) ** (k + 1) / k, 13));
    expect(result.polynomial).toBe('x − x^2/2 + x^3/3 − x^4/4 + x^5/5 − x^6/6');
    expect(result.remainder!.actual).toBeLessThanOrEqual(result.remainder!.bound);
    expect(result.partial(6, 0.5)).toBeCloseTo(0.5 - 0.125 + 0.125 / 3 - 0.0625 / 4 + 0.03125 / 5 - 0.015625 / 6, 14);
  });

  it('refuses a center where f is not defined', () => {
    expect(() => taylor({ f: 'ln(x)', center: 0, order: 3, from: 0, to: 1 })).toThrow('series-undefined');
  });

  it('gives the exact Lagrange bound when the largest derivative sits at an end', () => {
    const result = taylor({ f: '1/(1 - x)', center: 0, order: 3, at: 0.9, from: -0.5, to: 0.95 });
    expect(result.remainder!.bound).toBeCloseTo(65610, 3);
    expect(result.remainder!.actual).toBeLessThanOrEqual(result.remainder!.bound);
  });
});
