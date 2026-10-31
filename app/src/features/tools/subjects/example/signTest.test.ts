import { describe, expect, it } from 'vitest';
import { SubjectError } from '../errors';
import { signTest } from './signTest';

describe('one-sample sign test', () => {
  it('counts signs and gives the exact binomial p-value worked by hand', () => {
    // 9 of 10 above 0: P(S ≤ 1) = (1 + 10)/1024, so two-sided p = 22/1024.
    const r = signTest([1.2, 0.4, 2.2, 0.9, 3.1, 0.5, 1.7, -0.6, 0.8, 1.1]);
    expect([r.plus, r.minus, r.ties, r.n]).toEqual([9, 1, 0, 10]);
    expect(r.p).toBeCloseTo(22 / 1024, 12);
    expect(signTest([1.2, 0.4, 2.2, 0.9, 3.1, 0.5, 1.7, -0.6, 0.8, 1.1], 0, 'greater').p).toBeCloseTo(11 / 1024, 12);
    expect(signTest([1.2, 0.4, 2.2, 0.9, 3.1, 0.5, 1.7, -0.6, 0.8, 1.1], 0, 'less').p).toBeCloseTo(1023 / 1024, 12);
    expect(r.steps).toHaveLength(3);
  });

  it('drops values equal to the median and caps the two-sided p-value at one', () => {
    const r = signTest([5, 5, 6, 4], 5);
    expect([r.plus, r.minus, r.ties]).toEqual([1, 1, 2]);
    expect(r.p).toBe(1);
  });

  it('works with negative and huge values', () => {
    expect(signTest([-1e300, -2e300, -3e300], -1e299).minus).toBe(3);
  });

  it('refuses empty input, all ties, and values that are not numbers', () => {
    expect(() => signTest([])).toThrow(SubjectError);
    expect(() => signTest([2, 2], 2)).toThrow(SubjectError);
    expect(() => signTest([1, Number.NaN])).toThrow(SubjectError);
  });
});
