// Fill series (DESIGN.md section 13.6). Every expected value is worked by hand from the rule it tests.
import { describe, expect, it } from 'vitest';
import { continueSeries } from './series';

describe('numbers', () => {
  it('continues a line: 1, 3 goes on 5, 7', () => {
    expect(continueSeries(['1', '3'], 2)).toEqual(['5', '7']);
  });
  it('continues a falling line and a fraction', () => {
    expect(continueSeries(['10', '7'], 2)).toEqual(['4', '1']);
    expect(continueSeries(['0.1', '0.2'], 2)).toEqual(['0.3', '0.4']);
  });
  it('follows the least squares trend line when the steps differ', () => {
    // Points (0,1), (1,2), (2,6): slope 2.5, mean y 3, mean x 1, so x = 3 gives 3 + 2.5 * 2 = 8.
    expect(continueSeries(['1', '2', '6'], 1)).toEqual(['8']);
  });
  it('copies one number, and steps it when asked', () => {
    expect(continueSeries(['4'], 3)).toEqual(['4', '4', '4']);
    expect(continueSeries(['4'], 3, { step: 2 })).toEqual(['6', '8', '10']);
  });
  it('grows: 2, 4 goes on 8, 16', () => {
    expect(continueSeries(['2', '4'], 2, { growth: true })).toEqual(['8', '16']);
  });
  it('grows by a named step from one cell', () => {
    expect(continueSeries(['3'], 3, { growth: true, step: 2 })).toEqual(['6', '12', '24']);
  });
  it('copies in a cycle when asked', () => {
    expect(continueSeries(['1', '3'], 3, { copy: true })).toEqual(['1', '3', '1']);
  });
  it('goes backward when the cells come in reverse order', () => {
    // Dragging up from 1, 3 (top to bottom): the cells nearest first, in reverse order 3, 1.
    expect(continueSeries(['3', '1'], 2)).toEqual(['-1', '-3']);
  });
});

describe('dates', () => {
  it('moves a month at a time from the end of a month: 2026-01-31 goes on 2026-02-28, 2026-03-31', () => {
    expect(continueSeries(['2026-01-31'], 2, { unit: 'month' })).toEqual(['2026-02-28', '2026-03-31']);
  });
  it('moves a day at a time by default, across a leap day', () => {
    expect(continueSeries(['2028-02-28'], 2)).toEqual(['2028-02-29', '2028-03-01']);
  });
  it('keeps the gap the cells show', () => {
    expect(continueSeries(['2026-01-01', '2026-01-08'], 2)).toEqual(['2026-01-15', '2026-01-22']);
    expect(continueSeries(['2026-01-15', '2026-04-15'], 2)).toEqual(['2026-07-15', '2026-10-15']);
    expect(continueSeries(['2024-06-01', '2025-06-01'], 2)).toEqual(['2026-06-01', '2027-06-01']);
  });
  it('skips weekends in a weekday series', () => {
    // 2026-01-02 is a Friday: the next working days are Monday the 5th and Tuesday the 6th.
    expect(continueSeries(['2026-01-02'], 2, { unit: 'weekday' })).toEqual(['2026-01-05', '2026-01-06']);
  });
});

describe('names', () => {
  it('cycles months by the gap: Jan, Apr goes on Jul, Oct, then wraps', () => {
    expect(continueSeries(['Jan', 'Apr'], 3)).toEqual(['Jul', 'Oct', 'Jan']);
  });
  it('cycles weekdays: Mon goes on Tue', () => {
    expect(continueSeries(['Mon'], 2)).toEqual(['Tue', 'Wed']);
    expect(continueSeries(['Sat'], 2)).toEqual(['Sun', 'Mon']);
  });
  it('keeps the way a name is written', () => {
    expect(continueSeries(['JANUARY'], 1)).toEqual(['FEBRUARY']);
    expect(continueSeries(['tuesday'], 1)).toEqual(['wednesday']);
  });
});

describe('text with a number', () => {
  it('counts: Item 1 goes on Item 2', () => {
    expect(continueSeries(['Item 1'], 2)).toEqual(['Item 2', 'Item 3']);
  });
  it('uses the gap and keeps leading zeros and the ending (an ordinal ending follows the number)', () => {
    expect(continueSeries(['Q10', 'Q20'], 1)).toEqual(['Q30']);
    expect(continueSeries(['A007'], 2)).toEqual(['A008', 'A009']);
    expect(continueSeries(['1st'], 1)).toEqual(['2nd']);
  });
  it('repeats text with no number', () => {
    expect(continueSeries(['a', 'b'], 3)).toEqual(['a', 'b', 'a']);
  });
  it('repeats when a cell is empty', () => {
    expect(continueSeries(['1', ''], 2)).toEqual(['1', '']);
  });
});

describe('large and out of range series', () => {
  it('walks a weekday series in whole weeks: 20,000 cells in well under a second', () => {
    const start = performance.now();
    const out = continueSeries(['2026-01-02'], 20000, { unit: 'weekday' });
    expect(performance.now() - start).toBeLessThan(1000);
    // 2026-01-02 is a Friday. Monday, Tuesday, Wednesday follow, and every fifth cell is a Friday again.
    expect(out.slice(0, 3)).toEqual(['2026-01-05', '2026-01-06', '2026-01-07']);
    expect(out[4]).toBe('2026-01-09');
    expect(new Date(`${out[19999]}T00:00:00Z`).getUTCDay()).toBe(5);
  });
  it('counts weekdays from a weekend: Saturday plus one is Monday, Sunday minus one is Friday', () => {
    expect(continueSeries(['2026-01-03'], 2, { unit: 'weekday' })).toEqual(['2026-01-05', '2026-01-06']);
    expect(continueSeries(['2026-01-04'], 1, { unit: 'weekday', step: -1 })).toEqual(['2026-01-02']);
  });
  it('repeats the cells when the step runs past the dates a year can name', () => {
    expect(continueSeries(['2026-01-02'], 2, { unit: 'weekday', step: 1e9 })).toEqual(['2026-01-02', '2026-01-02']);
    expect(continueSeries(['9999-12-31'], 2)).toEqual(['9999-12-31', '9999-12-31']);
    expect(continueSeries(['0001-01-02', '0001-01-01'], 2)).toEqual(['0001-01-02', '0001-01-01']);
    expect(continueSeries(['9999-12-31'], 1, { unit: 'month' })).toEqual(['9999-12-31']);
  });
  it('repeats the cells when a number overflows', () => {
    expect(continueSeries(['1e300', '1e305'], 2, { growth: true })).toEqual(['1e300', '1e305']);
  });
});

describe('money, percent, padding, negatives, and ordinals', () => {
  it('copies one amount or percent, and steps a pair, keeping the sign', () => {
    expect(continueSeries(['$5'], 2)).toEqual(['$5', '$5']);
    expect(continueSeries(['10%'], 2)).toEqual(['10%', '10%']);
    expect(continueSeries(['$5', '$7'], 2)).toEqual(['$9', '$11']);
    expect(continueSeries(['10%', '20%'], 2)).toEqual(['30%', '40%']);
  });
  it('keeps the width of numbers written with leading zeros: 001, 002 goes on 003, 004', () => {
    expect(continueSeries(['001', '002'], 2)).toEqual(['003', '004']);
  });
  it('counts below zero: Item 3, Item 2 goes on Item 1, Item 0, Item -1', () => {
    expect(continueSeries(['Item 3', 'Item 2'], 3)).toEqual(['Item 1', 'Item 0', 'Item -1']);
  });
  it('writes ordinals: 1st goes on 2nd, 3rd, 4th, and 10th goes on 11th, 12th, 13th', () => {
    expect(continueSeries(['1st'], 3)).toEqual(['2nd', '3rd', '4th']);
    expect(continueSeries(['10th'], 3)).toEqual(['11th', '12th', '13th']);
  });
});
