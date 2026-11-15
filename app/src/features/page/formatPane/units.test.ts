// Lengths with units. Known answers are the definitions: an inch is 72 points, an inch is 2.54 cm and 25.4 mm, a CSS
// pixel is 1/96 inch, and a pica is 12 points.
import { describe, expect, it } from 'vitest';
import { formatLength, formatPoints, parseLength } from './units';

describe('parseLength', () => {
  it.each([
    ['0.5in', 36],
    ['1in', 72],
    ['2.54cm', 72],
    ['25.4mm', 72],
    ['96px', 72],
    ['1pc', 12],
    ['10.5pt', 10.5],
    ['10.5', 10.5],
    ['1,5 in', 108],
    ['-0.25in', -18],
    [' 12 pt ', 12],
  ])('reads %s as %s points', (text, points) => {
    expect(parseLength(text)).toBe(points);
  });

  it('reads a bare number in the unit given', () => {
    expect(parseLength('2', 'in')).toBe(144);
    expect(parseLength('1', 'cm')).toBe(28.35);
  });

  it.each(['', 'abc', '12 furlongs', '1..5', '12pt3'])('refuses %j', (text) => {
    expect(parseLength(text)).toBeNull();
  });
});

describe('formatting', () => {
  it('writes points without trailing zeros and other units to two places', () => {
    expect(formatPoints(36)).toBe('36');
    expect(formatPoints(10.5)).toBe('10.5');
    expect(formatLength(36, 'in')).toBe('0.5 in');
    expect(formatLength(72, 'cm')).toBe('2.54 cm');
    expect(formatLength(12, 'pt')).toBe('12');
  });
});
