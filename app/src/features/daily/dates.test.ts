import { describe, expect, it } from 'vitest';
import { addDays, addMonths, dayKey, daysInMonth, isoWeek, monthGrid, noteTitle, startOfWeek } from './dates';

describe('daily note dates', () => {
  it('keys days so they sort in date order', () => {
    expect(dayKey({ y: 2026, m: 3, d: 9 })).toBe('2026-03-09');
    expect(noteTitle('day', { y: 2026, m: 10, d: 3 })).toBe('2026-10-03');
  });

  it('moves across month and year ends', () => {
    expect(addDays({ y: 2026, m: 12, d: 31 }, 1)).toEqual({ y: 2027, m: 1, d: 1 });
    expect(addDays({ y: 2026, m: 3, d: 1 }, -1)).toEqual({ y: 2026, m: 2, d: 28 });
    expect(addMonths({ y: 2026, m: 1, d: 31 }, 1)).toEqual({ y: 2026, m: 2, d: 28 });
    expect(addMonths({ y: 2026, m: 1, d: 15 }, -2)).toEqual({ y: 2025, m: 11, d: 15 });
    expect(daysInMonth(2028, 2)).toBe(29);
  });

  it('names ISO weeks, including the ones that cross New Year', () => {
    expect(isoWeek({ y: 2026, m: 1, d: 1 })).toEqual({ year: 2026, week: 1 });
    expect(isoWeek({ y: 2027, m: 1, d: 1 })).toEqual({ year: 2026, week: 53 });
    expect(isoWeek({ y: 2024, m: 12, d: 30 })).toEqual({ year: 2025, week: 1 });
    expect(noteTitle('week', { y: 2026, m: 10, d: 3 })).toBe('2026-W40');
    expect(noteTitle('month', { y: 2026, m: 10, d: 3 })).toBe('2026-10');
    expect(noteTitle('year', { y: 2026, m: 10, d: 3 })).toBe('2026');
  });

  it('lays out six weeks that hold the month', () => {
    const grid = monthGrid(2026, 10, 0);
    expect(grid).toHaveLength(6);
    expect(grid[0][0]).toEqual({ y: 2026, m: 9, d: 27 });
    expect(grid.flat().some((day) => day.m === 10 && day.d === 31)).toBe(true);
    expect(monthGrid(2026, 10, 1)[0][0]).toEqual({ y: 2026, m: 9, d: 28 });
    expect(startOfWeek({ y: 2026, m: 10, d: 3 }, 1)).toEqual({ y: 2026, m: 9, d: 28 });
  });
});
