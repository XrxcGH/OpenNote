// Calendar dates without a time zone, as plain numbers. Day math uses a day count from 1970-01-01, never a Date
// object, so daylight saving time can't move a date. Time zones are handled in zone.ts.

export interface CivilDate {
  year: number;
  /** 1 to 12. */
  month: number;
  day: number;
}

export interface ClockTime {
  /** 0 to 23. */
  hour: number;
  minute: number;
}

/** When something is due, in the viewer's time zone. A null time means it is due any time that day. */
export interface Due {
  date: CivilDate;
  time: ClockTime | null;
}

/** 0 is Sunday, as in JavaScript. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const isLeapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function isValidDate(date: CivilDate): boolean {
  const { year, month, day } = date;
  const whole = Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day);
  return whole && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/** Days since 1970-01-01, which is negative before it. */
export function toDays({ year, month, day }: CivilDate): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * ((month + 9) % 12) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

export function fromDays(days: number): CivilDate {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365,
  );
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const shifted = Math.floor((5 * dayOfYear + 2) / 153);
  const month = shifted < 10 ? shifted + 3 : shifted - 9;
  const day = dayOfYear - Math.floor((153 * shifted + 2) / 5) + 1;
  return { year: yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

export const addDays = (date: CivilDate, days: number): CivilDate => fromDays(toDays(date) + days);

/** Adds months, and keeps the day if it fits, so Jan 31 plus one month is Feb 28 or 29. */
export function addMonths(date: CivilDate, months: number): CivilDate {
  const index = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

export function dayOfWeek(date: CivilDate): Weekday {
  return ((((toDays(date) + 4) % 7) + 7) % 7) as Weekday;
}

/** Negative if the first date is earlier, zero if they are the same day, and positive if it is later. */
export const compareDates = (a: CivilDate, b: CivilDate): number => toDays(a) - toDays(b);

export const sameDate = (a: CivilDate, b: CivilDate): boolean => compareDates(a, b) === 0;

/** The whole days from a to b. */
export const daysBetween = (a: CivilDate, b: CivilDate): number => toDays(b) - toDays(a);

/** The first day of the week that holds this date. */
export function startOfWeek(date: CivilDate, weekStart: Weekday = 0): CivilDate {
  return addDays(date, -((dayOfWeek(date) - weekStart + 7) % 7));
}

export const endOfMonth = (date: CivilDate): CivilDate => ({ ...date, day: daysInMonth(date.year, date.month) });

const pad = (n: number, width: number) => String(n).padStart(width, '0');

/** "2026-10-03", which sorts in date order and is fine as a map key. */
export const dateKey = ({ year, month, day }: CivilDate): string => `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;

/** The date from "2026-10-03", or null if the text isn't a real date. */
export function parseDateKey(text: string): CivilDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const date = match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null;
  return date && isValidDate(date) ? date : null;
}

export const minutesOf = (time: ClockTime): number => time.hour * 60 + time.minute;

/** Orders dues by date, then by time, with an all-day due before a timed one on the same day. */
export function compareDues(a: Due, b: Due): number {
  const byDate = compareDates(a.date, b.date);
  if (byDate !== 0) return byDate;
  return (a.time ? minutesOf(a.time) : -1) - (b.time ? minutesOf(b.time) : -1);
}
