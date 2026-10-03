// Calendar days for the daily note: plain year, month, and day numbers, so a day never shifts with the time zone.
// Weekly notes follow ISO 8601 weeks (Monday first, week 1 holds the first Thursday).

/** A calendar day. `m` is 1 to 12. */
export interface Ymd {
  y: number;
  m: number;
  d: number;
}

export type DailyKind = 'day' | 'week' | 'month' | 'year';

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

export const toYmd = (date: Date): Ymd => ({ y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() });

export const today = (): Ymd => toYmd(new Date());

const utc = (day: Ymd) => Date.UTC(day.y, day.m - 1, day.d);
const fromUtc = (ms: number): Ymd => {
  const date = new Date(ms);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
};

export const sameDay = (a: Ymd, b: Ymd): boolean => a.y === b.y && a.m === b.m && a.d === b.d;

/** `2026-10-03`, which sorts in date order. */
export const dayKey = (day: Ymd): string => `${pad(day.y, 4)}-${pad(day.m)}-${pad(day.d)}`;

/** The same day as local midnight, for the Intl formatters. */
export const toDate = (day: Ymd): Date => new Date(day.y, day.m - 1, day.d);

export function addDays(day: Ymd, days: number): Ymd {
  return fromUtc(utc(day) + days * 86_400_000);
}

/** Moves by whole months and keeps the day, or the last day of a shorter month. */
export function addMonths(day: Ymd, months: number): Ymd {
  const index = day.y * 12 + (day.m - 1) + months;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return { y, m, d: Math.min(day.d, daysInMonth(y, m)) };
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 0 is Sunday, as `Date` counts. */
export const weekdayOf = (day: Ymd): number => new Date(utc(day)).getUTCDay();

/** The first day of the week that holds `day`. `weekStart` is 0 for Sunday and 1 for Monday. */
export function startOfWeek(day: Ymd, weekStart: 0 | 1): Ymd {
  const back = (weekdayOf(day) - weekStart + 7) % 7;
  return addDays(day, -back);
}

/** The ISO week of a day: the week-year can differ from the calendar year around New Year. */
export function isoWeek(day: Ymd): { year: number; week: number } {
  const thursday = addDays(day, 3 - ((weekdayOf(day) + 6) % 7));
  const jan1 = { y: thursday.y, m: 1, d: 1 };
  const week = 1 + Math.floor((utc(thursday) - utc(jan1)) / (7 * 86_400_000));
  return { year: thursday.y, week };
}

/** The title of the note for the day, its week, its month, or its year. */
export function noteTitle(kind: DailyKind, day: Ymd): string {
  switch (kind) {
    case 'day':
      return dayKey(day);
    case 'week': {
      const { year, week } = isoWeek(day);
      return `${pad(year, 4)}-W${pad(week)}`;
    }
    case 'month':
      return `${pad(day.y, 4)}-${pad(day.m)}`;
    case 'year':
      return pad(day.y, 4);
  }
}

/** Six rows of seven days that cover the month, starting on the first day of the week. */
export function monthGrid(year: number, month: number, weekStart: 0 | 1): Ymd[][] {
  const first = startOfWeek({ y: year, m: month, d: 1 }, weekStart);
  return Array.from({ length: 6 }, (_row, row) => Array.from({ length: 7 }, (_cell, col) => addDays(first, row * 7 + col)));
}

/** The calendar day of a Unix time in milliseconds, in the local time zone. */
export const dayOfMs = (ms: number): Ymd => toYmd(new Date(ms));
