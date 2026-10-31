// The arithmetic Hebrew calendar. A month is 29 days, 12 hours, and 793 parts (1080 parts to the hour). The new
// year falls on the day of the molad (mean conjunction) of Tishrei, moved by the four postponement rules. Years 3,
// 6, 8, 11, 14, 17, and 19 of each 19-year cycle add a thirteenth month. Months are numbered from Tishrei.
import { mod } from './jdn';

export const PARTS_PER_HOUR = 1080;
export const PARTS_PER_DAY = 24 * PARTS_PER_HOUR;
export const MONTH_PARTS = 29 * PARTS_PER_DAY + 12 * PARTS_PER_HOUR + 793;
/** The molad of Tishrei of year 1 (BaHaRaD): day 2 (Monday), 5 hours, 204 parts, from the evening of day 1. */
export const BAHARAD = PARTS_PER_DAY + 5 * PARTS_PER_HOUR + 204;
/** The day before 1 Tishrei of year 1 (a Monday, 7 October 3761 BCE Julian). */
const EPOCH = 347997;

export const isHebrewLeap = (year: number): boolean => mod(7 * year + 1, 19) < 7;
export const monthsElapsed = (year: number): number => Math.floor((235 * year - 234) / 19);

export interface Molad {
  /** Days from the epoch: the day the molad falls on. */
  day: number;
  /** 0 for Sunday through 6 for Saturday. */
  weekday: number;
  hours: number;
  parts: number;
}

export function moladTishrei(year: number): Molad {
  const total = BAHARAD + monthsElapsed(year) * MONTH_PARTS;
  const day = Math.floor(total / PARTS_PER_DAY);
  const within = total - day * PARTS_PER_DAY;
  return {
    day,
    weekday: mod(day, 7),
    hours: Math.floor(within / PARTS_PER_HOUR),
    parts: within % PARTS_PER_HOUR,
  };
}

export type Postponement = 'zaken' | 'gatarad' | 'betutakpat' | 'adu';

/** The day of 1 Tishrei, with the postponements that moved it, in the order they apply. */
export function newYearDay(year: number): { day: number; rules: Postponement[] } {
  const molad = moladTishrei(year);
  const within = molad.hours * PARTS_PER_HOUR + molad.parts;
  const rules: Postponement[] = [];
  let day = molad.day;
  if (within >= 18 * PARTS_PER_HOUR) {
    rules.push('zaken');
    day += 1;
  } else if (molad.weekday === 2 && within >= 9 * PARTS_PER_HOUR + 204 && !isHebrewLeap(year)) {
    // Tuesday after 9 h 204 p in a common year: two days, to Thursday, since Wednesday is not allowed.
    rules.push('gatarad');
    day += 2;
  } else if (molad.weekday === 1 && within >= 15 * PARTS_PER_HOUR + 589 && isHebrewLeap(year - 1)) {
    rules.push('betutakpat');
    day += 1;
  }
  if ([0, 3, 5].includes(mod(day, 7))) {
    rules.push('adu');
    day += 1;
  }
  return { day, rules };
}

export const newYearJdn = (year: number): number => EPOCH + newYearDay(year).day;
export const yearLength = (year: number): number => newYearJdn(year + 1) - newYearJdn(year);

/** Month lengths from Tishrei. A leap year has Adar I (30) and Adar II (29); a common year one Adar (29). */
export function monthLengths(year: number): number[] {
  const length = yearLength(year);
  const kind = length % 10; // 3 deficient, 4 regular, 5 complete
  const heshvan = kind === 5 ? 30 : 29;
  const kislev = kind === 3 ? 29 : 30;
  const adar = isHebrewLeap(year) ? [30, 29] : [29];
  return [30, heshvan, kislev, 29, 30, ...adar, 30, 29, 30, 29, 30, 29];
}

export type YearKind = 'deficient' | 'regular' | 'complete';
export const yearKind = (year: number): YearKind =>
  (['deficient', 'regular', 'complete'] as const)[(yearLength(year) % 10) - 3]!;

export function hebrewToJdn(year: number, month: number, day: number): number {
  if (!Number.isInteger(year) || year < 1) throw new Error('hebrewYear');
  const lengths = monthLengths(year);
  if (!Number.isInteger(month) || month < 1 || month > lengths.length) throw new Error('month');
  if (!Number.isInteger(day) || day < 1 || day > lengths[month - 1]!) throw new Error('day');
  return newYearJdn(year) + lengths.slice(0, month - 1).reduce((sum, n) => sum + n, 0) + day - 1;
}

export function jdnToHebrew(jdn: number): { year: number; month: number; day: number } {
  if (jdn <= EPOCH) throw new Error('beforeEpoch');
  let year = Math.floor((jdn - EPOCH) / 365.2468) + 1;
  while (newYearJdn(year) > jdn) year -= 1;
  while (newYearJdn(year + 1) <= jdn) year += 1;
  let rest = jdn - newYearJdn(year);
  const lengths = monthLengths(year);
  let month = 1;
  while (rest >= lengths[month - 1]!) {
    rest -= lengths[month - 1]!;
    month += 1;
  }
  return { year, month, day: rest + 1 };
}

/** The month's key in the strings, by its number from Tishrei in this year. */
export function hebrewMonthKey(year: number, month: number): string {
  const common = [
    'tishrei',
    'heshvan',
    'kislev',
    'tevet',
    'shevat',
    'adar',
    'nisan',
    'iyar',
    'sivan',
    'tammuz',
    'av',
    'elul',
  ];
  if (!isHebrewLeap(year)) return common[month - 1]!;
  const leap = [
    'tishrei',
    'heshvan',
    'kislev',
    'tevet',
    'shevat',
    'adar1',
    'adar2',
    'nisan',
    'iyar',
    'sivan',
    'tammuz',
    'av',
    'elul',
  ];
  return leap[month - 1]!;
}

/** The main holidays of a Hebrew year: a key and the JDN. Purim is in Adar II in a leap year. */
export function hebrewHolidays(year: number): { key: string; jdn: number }[] {
  const leap = isHebrewLeap(year);
  const nisan = leap ? 8 : 7;
  return [
    { key: 'roshHashanah', jdn: hebrewToJdn(year, 1, 1) },
    { key: 'yomKippur', jdn: hebrewToJdn(year, 1, 10) },
    { key: 'sukkot', jdn: hebrewToJdn(year, 1, 15) },
    { key: 'sheminiAtzeret', jdn: hebrewToJdn(year, 1, 22) },
    { key: 'hanukkah', jdn: hebrewToJdn(year, 3, 25) },
    { key: 'purim', jdn: hebrewToJdn(year, leap ? 7 : 6, 14) },
    { key: 'passover', jdn: hebrewToJdn(year, nisan, 15) },
    { key: 'shavuot', jdn: hebrewToJdn(year, nisan + 2, 6) },
    { key: 'tishaBav', jdn: hebrewToJdn(year, nisan + 4, 9) },
  ];
}
