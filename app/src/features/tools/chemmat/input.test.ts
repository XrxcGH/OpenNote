import { describe, expect, it } from 'vitest';
import { parseNumber } from './input';

describe('parseNumber', () => {
  it.each([
    ['1.2×10^5', 120000],
    ['1.2 × 10^5', 120000],
    ['1.2 x 10^5', 120000],
    ['3×10-4', 3e-4],
    ['1,250.5', 1250.5],
    ['−4', -4],
    ['2e3', 2000],
  ])('reads %s', (text, expected) => {
    expect(parseNumber(text)).toBeCloseTo(expected, 9);
  });

  it('gives null for empty and NaN for text', () => {
    expect(parseNumber('  ')).toBeNull();
    expect(parseNumber('abc')).toBeNaN();
    expect(parseNumber('1.2 × 10^')).toBeNaN();
  });
});
