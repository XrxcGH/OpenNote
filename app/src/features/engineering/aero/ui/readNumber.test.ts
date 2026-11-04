import { describe, expect, it } from 'vitest';
import { readNumber } from './spec';

describe('reading a number in the aerospace window', () => {
  it('reads digits, a power of ten, and a short expression', () => {
    expect(readNumber('2.5e3')).toBe(2500);
    expect(readNumber('1/4')).toBe(0.25);
    expect(readNumber('2*pi')).toBeCloseTo(2 * Math.PI, 12);
    expect(readNumber(' ')).toBeUndefined();
  });

  it('does not accept a half-typed exponent as 2.5 times e', () => {
    expect(readNumber('2.5e')).toBeNaN();
    expect(readNumber('1e-')).toBeNaN();
  });
});
