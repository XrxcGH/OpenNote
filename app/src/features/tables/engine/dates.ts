// Calendar days. A date is a spreadsheet serial: the number of days since 1899-12-30, with no time zone, fractional
// when it has a time. Day 0 is 1899-12-30, as Sheets and LibreOffice count, which equals Excel's serial for every date
// from 1900-03-01 (Excel also counts a 1900-02-29 that never existed). Dates before day 0 are negative serials.
// dateToSerial and serialToDate are the only places that turn serials into milliseconds and back.

import type { DateOrder } from './locale';

const DAY_MS = 86_400_000;
/** Days from 1899-12-30 to 1970-01-01, where JavaScript's clock starts. */
const UNIX_DAY = 25_569;
const MONTHS = 'january february march april may june july august september october november december'.split(' ');

export interface Ymd {
  y: number;
  m: number;
  d: number;
}

/** The serial of a moment read as UTC: its calendar day, plus the time of day as a fraction. */
export function dateToSerial(date: Date): number {
  return date.getTime() / DAY_MS + UNIX_DAY;
}

/** The moment a serial stands for, as UTC. Formatters show it with the UTC time zone. */
export function serialToDate(serial: number): Date {
  return new Date(Math.round((serial - UNIX_DAY) * DAY_MS));
}

/** The serial of a calendar date, or null when the date doesn't exist, such as February 30. */
export function ymdToDays(y: number, m: number, d: number): number | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = utcDate(y, m, d);
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return dateToSerial(date);
}

/** A UTC date. Date.UTC reads years 0 to 99 as 1900 to 1999, so the year is set on its own. */
function utcDate(y: number, m: number, d: number): Date {
  const date = new Date(Date.UTC(2000, m - 1, d));
  date.setUTCFullYear(y, m - 1, d);
  return date;
}

/** The serial of a year, month, and day that may run over, as DATE counts: month 13 is January of the next year. */
export function ymdToSerial(y: number, m: number, d: number): number {
  return dateToSerial(utcDate(y, m, d));
}

export function daysToYmd(days: number): Ymd {
  const date = serialToDate(Math.floor(days));
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

/** The day of the week, 0 for Sunday to 6 for Saturday. Day 0, 1899-12-30, was a Saturday. */
export function weekdayOf(days: number): number {
  return (((Math.floor(days) + 6) % 7) + 7) % 7;
}

/** Today's calendar day in the device's own time zone. */
export function todayDays(now: Date = new Date()): number {
  return ymdToSerial(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** Excel's 1900 date system: from serial 60 it counts as we do; earlier serials skip its false 1900-02-29. */
export function excelSerialToDays(serial: number): number {
  return serial < 60 ? serial + 1 : serial;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** The canonical text of a date: YYYY-MM-DD, with THH:MM or THH:MM:SS when it has a time. */
export function daysToIso(days: number): string {
  const { y, m, d } = daysToYmd(days);
  const base = `${String(y).padStart(4, '0')}-${pad(m)}-${pad(d)}`;
  const seconds = Math.round((days - Math.floor(days)) * 86400);
  if (seconds === 0) return base;
  const time = `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}`;
  return seconds % 60 === 0 ? `${base}T${time}` : `${base}T${time}:${pad(seconds % 60)}`;
}

function timeFraction(h?: string, min?: string, s?: string): number | null {
  if (h === undefined) return 0;
  const hour = Number(h);
  const minute = Number(min);
  const second = Number(s ?? 0);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return (hour * 3600 + minute * 60 + second) / 86400;
}

function withTime(days: number | null, h?: string, min?: string, s?: string): number | null {
  const time = timeFraction(h, min, s);
  return days === null || time === null ? null : days + time;
}

/** Two-digit years mean 1950 to 2049, the Windows default. */
function fullYear(text: string): number {
  const n = Number(text);
  return text.length > 2 ? n : n < 50 ? 2000 + n : 1900 + n;
}

function monthFromName(word: string): number | null {
  const lower = word.toLowerCase();
  if (lower.length < 3) return null;
  const at = MONTHS.findIndex((name) => name.startsWith(lower));
  return at === -1 ? null : at + 1;
}

const TIME = '(?:[T ](\\d{1,2}):(\\d{2})(?::(\\d{2}))?)?';
const ISO = new RegExp(`^(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})${TIME}$`);
const NUMERIC = new RegExp(`^(\\d{1,2})[/.\\-](\\d{1,2})[/.\\-](\\d{4}|\\d{2})${TIME}$`);
const DAY_FIRST = new RegExp(
  `^(?:[A-Za-z]+,?\\s+)?(\\d{1,2})[\\s.\\-]+([A-Za-z]{3,9})\\.?,?[\\s.\\-]+(\\d{2,4})${TIME}$`,
);
const MONTH_FIRST = new RegExp(
  `^(?:[A-Za-z]+,?\\s+)?([A-Za-z]{3,9})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{2,4})${TIME}$`,
);

/**
 * Reads a date in ISO form, numeric form in the given order, or with an English month name.
 * A numeric date that contradicts the order (a month over 12) is null, so callers can try the other order.
 */
export function parseDate(input: string, order: DateOrder): number | null {
  const text = input.trim();
  let m = ISO.exec(text);
  if (m) return withTime(ymdToDays(Number(m[1]), Number(m[2]), Number(m[3])), m[4], m[5], m[6]);
  m = NUMERIC.exec(text);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    const [month, day] = order === 'dmy' ? [b, a] : [a, b];
    return withTime(ymdToDays(fullYear(m[3]), month, day), m[4], m[5], m[6]);
  }
  m = DAY_FIRST.exec(text);
  if (m) {
    const month = monthFromName(m[2]);
    return month === null ? null : withTime(ymdToDays(fullYear(m[3]), month, Number(m[1])), m[4], m[5], m[6]);
  }
  m = MONTH_FIRST.exec(text);
  if (!m) return null;
  const month = monthFromName(m[1]);
  return month === null ? null : withTime(ymdToDays(fullYear(m[3]), month, Number(m[2])), m[4], m[5], m[6]);
}

/** Reads canonical date text (ISO only). */
export function parseIsoDate(text: string): number | null {
  return ISO.test(text.trim()) ? parseDate(text, 'ymd') : null;
}
