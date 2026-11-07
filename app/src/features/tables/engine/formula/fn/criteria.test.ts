// Criteria, from the documented rules of COUNTIF and its relatives. Expected counts are worked by hand.

import { describe, expect, it } from 'vitest';
import { countIf, hasWildcard, matchMask, parseCriterion, wildcardPattern } from './criteria';
import { ymdToSerial } from '../../dates';
import { err } from '../../values';

const FRUIT = ['apple', 'apricot', 'banana'];

describe('criteria', () => {
  it('matches wildcards, inequality, and an escaped asterisk (lane test)', () => {
    expect(countIf(FRUIT, 'ap*')).toBe(2);
    expect(countIf(FRUIT, '<>banana')).toBe(2);
    expect(countIf(['*', 'a*', 'x'], '~*')).toBe(1);
    expect(countIf(['*', 'a*', 'x'], '*')).toBe(3);
  });

  it('reads ? as one character and ignores case', () => {
    expect(countIf(['cat', 'Cot', 'cart'], 'c?t')).toBe(2);
    expect(countIf(['APPLE', 'apple'], 'apple')).toBe(2);
    expect(countIf(['a?', 'ab'], 'a~?')).toBe(1);
    expect(countIf(['~', 'a'], '~~')).toBe(1);
  });

  it('compares numbers, with or without an operator', () => {
    const values = [1, 5, 10, '5', 'x', null, true];
    expect(countIf(values, 5)).toBe(2);
    expect(countIf(values, '5')).toBe(2);
    expect(countIf(values, '>4')).toBe(2);
    expect(countIf(values, '<=5')).toBe(2);
    expect(countIf(values, '<>5')).toBe(5);
    expect(countIf(values, '>=50%')).toBe(3);
  });

  it('reads dates in criteria as serials', () => {
    const jan1 = ymdToSerial(2026, 1, 1);
    const values = [jan1 - 1, jan1, jan1 + 31];
    expect(countIf(values, '>2026-01-01')).toBe(1);
    expect(countIf(values, '>=2026-01-01')).toBe(2);
  });

  it('matches blanks', () => {
    const values = [null, '', 'a', 0];
    expect(countIf(values, '=')).toBe(1);
    expect(countIf(values, '')).toBe(2);
    expect(countIf(values, '<>')).toBe(3);
    // An empty criterion cell is 0.
    expect(countIf(values, null)).toBe(1);
  });

  it('matches booleans and errors', () => {
    const values = [true, false, 'TRUE', err('NA'), err('DIV0')];
    expect(countIf(values, true)).toBe(1);
    expect(countIf(values, 'TRUE')).toBe(1);
    expect(countIf(values, '#N/A')).toBe(1);
    expect(countIf(values, err('DIV0'))).toBe(1);
  });

  it('compares text with < and >, and never across kinds', () => {
    expect(countIf(['apple', 'banana', 'cherry', 3], '>b')).toBe(2);
    expect(countIf(['apple', 'banana', 3], '<b')).toBe(1);
  });

  it('exposes the pieces the families build on', () => {
    expect(hasWildcard('a~*')).toBe(false);
    expect(hasWildcard('a*')).toBe(true);
    expect(wildcardPattern('a*z').test('ABCZ')).toBe(true);
    expect(matchMask(FRUIT, 'b*')).toEqual([false, false, true]);
    expect(parseCriterion('<>')('x')).toBe(true);
  });
});
