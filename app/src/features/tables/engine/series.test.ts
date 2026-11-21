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
  it('uses the gap and keeps leading zeros and the ending', () => {
    expect(continueSeries(['Q10', 'Q20'], 1)).toEqual(['Q30']);
    expect(continueSeries(['A007'], 2)).toEqual(['A008', 'A009']);
    expect(continueSeries(['1st'], 1)).toEqual(['2st']);
  });
  it('repeats text with no number', () => {
    expect(continueSeries(['a', 'b'], 3)).toEqual(['a', 'b', 'a']);
  });
  it('repeats when a cell is empty', () => {
    expect(continueSeries(['1', ''], 2)).toEqual(['1', '']);
  });
});
