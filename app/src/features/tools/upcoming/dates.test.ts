import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  compareDues,
  dateKey,
  dayOfWeek,
  daysInMonth,
  endOfMonth,
  fromDays,
  isValidDate,
  parseDateKey,
  startOfWeek,
  toDays,
} from './date';
import { dateIn, dueAt, dueInstant, isValidTimeZone, toInstant, wallTime } from './zone';

const NY = 'America/New_York';

describe('civil dates', () => {
  it('counts days from 1970-01-01', () => {
    expect(toDays({ year: 1970, month: 1, day: 1 })).toBe(0);
    expect(toDays({ year: 1969, month: 12, day: 31 })).toBe(-1);
    expect(toDays({ year: 2000, month: 3, day: 1 })).toBe(11017);
    expect(dayOfWeek({ year: 1970, month: 1, day: 1 })).toBe(4);
    expect(dayOfWeek({ year: 2026, month: 10, day: 1 })).toBe(4);
    expect(dayOfWeek({ year: 2000, month: 2, day: 29 })).toBe(2);
  });

  it('round-trips every day across several centuries', () => {
    for (let days = -80_000; days <= 80_000; days += 7) {
      const date = fromDays(days);
      expect(isValidDate(date)).toBe(true);
      expect(toDays(date)).toBe(days);
    }
  });

  it('knows month lengths and leap years', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(isValidDate({ year: 2026, month: 2, day: 29 })).toBe(false);
    expect(isValidDate({ year: 2026, month: 13, day: 1 })).toBe(false);
    expect(isValidDate({ year: 2026, month: 4, day: 31 })).toBe(false);
    expect(isValidDate({ year: 2026, month: 1.5, day: 1 })).toBe(false);
  });
});

describe('date arithmetic', () => {
  it('adds days and months, keeping the day when it fits', () => {
    expect(addDays({ year: 2026, month: 12, day: 30 }, 3)).toEqual({ year: 2027, month: 1, day: 2 });
    expect(addDays({ year: 2026, month: 3, day: 1 }, -1)).toEqual({ year: 2026, month: 2, day: 28 });
    expect(addMonths({ year: 2026, month: 1, day: 31 }, 1)).toEqual({ year: 2026, month: 2, day: 28 });
    expect(addMonths({ year: 2028, month: 1, day: 31 }, 1)).toEqual({ year: 2028, month: 2, day: 29 });
    expect(addMonths({ year: 2026, month: 11, day: 15 }, 3)).toEqual({ year: 2027, month: 2, day: 15 });
    expect(addMonths({ year: 2026, month: 2, day: 15 }, -3)).toEqual({ year: 2025, month: 11, day: 15 });
    expect(endOfMonth({ year: 2028, month: 2, day: 3 })).toEqual({ year: 2028, month: 2, day: 29 });
  });

  it('finds the start of a week for a chosen first day', () => {
    const thursday = { year: 2026, month: 10, day: 1 };
    expect(startOfWeek(thursday)).toEqual({ year: 2026, month: 9, day: 27 });
    expect(startOfWeek(thursday, 1)).toEqual({ year: 2026, month: 9, day: 28 });
    expect(startOfWeek({ year: 2026, month: 9, day: 27 })).toEqual({ year: 2026, month: 9, day: 27 });
    expect(startOfWeek({ year: 2026, month: 9, day: 27 }, 1)).toEqual({ year: 2026, month: 9, day: 21 });
  });

  it('makes sortable keys and reads them back', () => {
    expect(dateKey({ year: 2026, month: 3, day: 7 })).toBe('2026-03-07');
    expect(parseDateKey('2026-03-07')).toEqual({ year: 2026, month: 3, day: 7 });
    expect(parseDateKey('2026-02-30')).toBeNull();
    expect(parseDateKey('soon')).toBeNull();
  });

  it('orders dues by date, then all-day before timed, then time', () => {
    const day = { year: 2026, month: 10, day: 1 };
    const dues = [
      { date: addDays(day, 1), time: null },
      { date: day, time: { hour: 17, minute: 0 } },
      { date: day, time: null },
      { date: day, time: { hour: 9, minute: 30 } },
    ];
    expect([...dues].sort(compareDues).map((d) => d.time && d.time.hour)).toEqual([null, 9, 17, null]);
  });
});

describe('time zones', () => {
  it('reads wall-clock time in a zone', () => {
    const instant = Date.UTC(2026, 9, 1, 14, 30);
    expect(wallTime(instant, NY)).toEqual({
      date: { year: 2026, month: 10, day: 1 },
      time: { hour: 10, minute: 30, second: 0 },
    });
    expect(dateIn(instant, 'Asia/Tokyo')).toEqual({ year: 2026, month: 10, day: 1 });
    expect(dateIn(Date.UTC(2026, 9, 1, 16, 0), 'Asia/Tokyo')).toEqual({ year: 2026, month: 10, day: 2 });
    expect(wallTime(Date.UTC(2026, 9, 1, 4, 0), NY).time.hour).toBe(0);
  });

  it('turns wall-clock time into an instant, before and after the clocks change', () => {
    expect(toInstant({ year: 2026, month: 1, day: 15 }, { hour: 9, minute: 0 }, NY)).toBe(Date.UTC(2026, 0, 15, 14, 0));
    expect(toInstant({ year: 2026, month: 7, day: 15 }, { hour: 9, minute: 0 }, NY)).toBe(Date.UTC(2026, 6, 15, 13, 0));
    expect(toInstant({ year: 2026, month: 7, day: 15 }, { hour: 9, minute: 0 }, 'UTC')).toBe(
      Date.UTC(2026, 6, 15, 9, 0),
    );
  });

  it('handles the hour that does not exist and the hour that happens twice', () => {
    // New York skips 2:00 to 3:00 on 2026-03-08, and repeats 1:00 to 2:00 on 2026-11-01.
    const gap = toInstant({ year: 2026, month: 3, day: 8 }, { hour: 2, minute: 30 }, NY);
    expect(gap).toBe(Date.UTC(2026, 2, 8, 7, 30));
    expect(wallTime(gap, NY).time.hour).toBe(3);
    const twice = toInstant({ year: 2026, month: 11, day: 1 }, { hour: 1, minute: 30 }, NY);
    expect(twice).toBe(Date.UTC(2026, 10, 1, 5, 30));
    expect(toInstant({ year: 2026, month: 11, day: 1 }, { hour: 2, minute: 30 }, NY)).toBe(
      Date.UTC(2026, 10, 1, 7, 30),
    );
  });
});

describe('zones and due dates', () => {
  it('round-trips through a zone with a half-hour offset', () => {
    const date = { year: 2026, month: 10, day: 1 };
    const instant = toInstant(date, { hour: 23, minute: 45 }, 'Asia/Kolkata');
    expect(instant).toBe(Date.UTC(2026, 9, 1, 18, 15));
    expect(dueAt(instant, 'Asia/Kolkata')).toEqual({ date, time: { hour: 23, minute: 45 } });
  });

  it('treats a date-only due as the end of its day', () => {
    const due = { date: { year: 2026, month: 3, day: 8 }, time: null };
    expect(dueInstant(due, NY)).toBe(toInstant({ year: 2026, month: 3, day: 9 }, { hour: 0, minute: 0 }, NY) - 1);
    expect(dueInstant({ ...due, time: { hour: 9, minute: 0 } }, NY)).toBe(Date.UTC(2026, 2, 8, 13, 0));
  });

  it('recognizes zone names', () => {
    expect(isValidTimeZone('America/Chicago')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Eastern Standard Time')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});
