// Week and month grids for a calendar view, as plain data. The UI picks the labels, because names of months and
// days depend on the locale.

import {
  addDays,
  compareDates,
  compareDues,
  dateKey,
  dayOfWeek,
  daysBetween,
  endOfMonth,
  sameDate,
  startOfWeek,
  type CivilDate,
  type Weekday,
} from './date';
import type { UpcomingItem } from './group';

export interface CalendarDay {
  date: CivilDate;
  /** "2026-10-03", for looking up the day's items. */
  key: string;
  /** False for the days of the neighboring months that fill out a month grid. */
  inMonth: boolean;
  today: boolean;
  weekend: boolean;
}

export interface GridOptions {
  /** The first column, 0 for Sunday. The default is Sunday, as in en-US. */
  weekStart?: Weekday;
  /** 'auto' uses as many rows as the month needs, 4 to 6. 6 always uses six, so the grid keeps its height. */
  rows?: 'auto' | 6;
}

function makeDay(date: CivilDate, today: CivilDate, inMonth: boolean): CalendarDay {
  const weekday = dayOfWeek(date);
  return { date, key: dateKey(date), inMonth, today: sameDate(date, today), weekend: weekday === 0 || weekday === 6 };
}

/** The seven days of the week that holds this date. */
export function weekGrid(anchor: CivilDate, today: CivilDate, weekStart: Weekday = 0): CalendarDay[] {
  const first = startOfWeek(anchor, weekStart);
  return Array.from({ length: 7 }, (_, i) => makeDay(addDays(first, i), today, true));
}

/** The weeks of a month, each with seven days, including the neighboring days that fill the first and last week. */
export function monthGrid(year: number, month: number, today: CivilDate, options: GridOptions = {}): CalendarDay[][] {
  const first: CivilDate = { year, month, day: 1 };
  const start = startOfWeek(first, options.weekStart ?? 0);
  const needed = Math.ceil((daysBetween(start, endOfMonth(first)) + 1) / 7);
  const rows = options.rows === 6 ? 6 : needed;
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: 7 }, (_, column) => {
      const date = addDays(start, row * 7 + column);
      return makeDay(date, today, date.year === year && date.month === month);
    }),
  );
}

/** The month before or after, as a year and month. Use it for the previous and next buttons. */
export function shiftMonth(year: number, month: number, months: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + months;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** The dated items by day key, each day in time order with all-day items first. Items with no date are left out. */
export function bucketByDay(items: readonly UpcomingItem[]): Map<string, UpcomingItem[]> {
  const dated = items.flatMap((item) => (item.due ? [{ item, due: item.due }] : []));
  dated.sort((a, b) => compareDues(a.due, b.due));
  const days = new Map<string, UpcomingItem[]>();
  for (const { item, due } of dated) {
    const key = dateKey(due.date);
    days.set(key, [...(days.get(key) ?? []), item]);
  }
  return days;
}

/** True if the date is between two dates, including both ends. */
export function isBetween(date: CivilDate, from: CivilDate, to: CivilDate): boolean {
  return compareDates(date, from) >= 0 && compareDates(date, to) <= 0;
}
