// Two calendars set by the sky. The Solar Hijri year begins on the day of the March equinox if the equinox comes
// before noon in Tehran (UTC+3:30), and on the next day if not. The Chinese month begins on the day of a new moon at
// UTC+8; the month holding the winter solstice is the eleventh, and in a year of 13 months the first month without
// a principal solar term is the leap month.
import { localDay, localTime, lunationBefore, marchEquinox, newMoon, sunAtLongitude } from './astro';
import { gregorianToJdn, mod } from './jdn';

export const TEHRAN = 3.5;
export const BEIJING = 8;

export interface Nowruz {
  jdn: number;
  /** The equinox as a UT Julian day. */
  equinox: number;
  /** The equinox in Tehran time. */
  hours: number;
  minutes: number;
  afterNoon: boolean;
}

/** 1 Farvardin of a Solar Hijri year (Gregorian year = year + 621). */
export function nowruz(year: number): Nowruz {
  if (!Number.isInteger(year) || year < 379 || year > 2379) throw new Error('persianYear');
  const equinox = marchEquinox(year + 621);
  const { hours, minutes } = localTime(equinox, TEHRAN);
  const afterNoon = hours >= 12;
  return { jdn: localDay(equinox, TEHRAN) + (afterNoon ? 1 : 0), equinox, hours, minutes, afterNoon };
}

/** The 33-year approximation: leap when the year leaves 1, 5, 9, 13, 17, 22, 26, or 30 on division by 33. */
export const persianLeap33 = (year: number): boolean => [1, 5, 9, 13, 17, 22, 26, 30].includes(mod(year, 33));
export const persianLeap = (year: number): boolean => nowruz(year + 1).jdn - nowruz(year).jdn === 366;

/** Months 1 to 6 have 31 days, 7 to 11 have 30, and Esfand has 29, or 30 in a leap year. */
export const persianMonthLength = (year: number, month: number): number =>
  month <= 6 ? 31 : month <= 11 ? 30 : persianLeap(year) ? 30 : 29;

export function persianToJdn(year: number, month: number, day: number): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error('month');
  if (!Number.isInteger(day) || day < 1 || day > persianMonthLength(year, month)) throw new Error('day');
  return nowruz(year).jdn + (month <= 7 ? 31 * (month - 1) : 186 + 30 * (month - 7)) + day - 1;
}

export function jdnToPersian(jdn: number): { year: number; month: number; day: number } {
  let year = Math.floor((jdn - 1948320) / 365.2422) + 1;
  while (year > 1 && nowruz(year).jdn > jdn) year -= 1;
  while (nowruz(year + 1).jdn <= jdn) year += 1;
  const days = jdn - nowruz(year).jdn;
  if (days < 0) throw new Error('beforeEpoch');
  if (days < 186) return { year, month: Math.floor(days / 31) + 1, day: (days % 31) + 1 };
  return { year, month: Math.floor((days - 186) / 30) + 7, day: ((days - 186) % 30) + 1 };
}

export interface ChineseMonth {
  /** The JDN of its first day. */
  start: number;
  number: number;
  leap: boolean;
}

/** The day (at UTC+8) of the solar longitude reached nearest the given Gregorian month. */
function termDay(longitude: number, year: number, month: number, day: number): number {
  return localDay(sunAtLongitude(longitude, gregorianToJdn({ year, month, day })), BEIJING);
}

const newMoonDay = (k: number): number => localDay(newMoon(k), BEIJING);

/** The lunation of the month that holds this day (the last new moon on or before it, by the UTC+8 date). */
function lunationOf(day: number): number {
  let k = lunationBefore(day + 1);
  while (newMoonDay(k) > day) k -= 1;
  while (newMoonDay(k + 1) <= day) k += 1;
  return k;
}

/**
 * The months from the eleventh month of the year before through the month before the next eleventh month: the sui
 * between the winter solstices of year − 1 and year.
 */
export function chineseSui(year: number): ChineseMonth[] {
  if (!Number.isInteger(year) || year < 1645 || year > 2400) throw new Error('chineseYear');
  const first = lunationOf(termDay(270, year - 1, 12, 21));
  const next = lunationOf(termDay(270, year, 12, 21));
  const lunations = Array.from({ length: next - first + 1 }, (_, i) => first + i);
  const starts = lunations.map(newMoonDay);
  // Principal terms (zhongqi) fall every 30 degrees; find whether each month holds one.
  const terms: number[] = [];
  for (let i = 0; i <= 12; i++) {
    const longitude = (270 + 30 * i) % 360;
    const guess = gregorianToJdn({ year: year - 1, month: 12, day: 21 }) + 30.44 * i;
    terms.push(localDay(sunAtLongitude(longitude, guess), BEIJING));
  }
  const holds = (i: number) => terms.some((day) => day >= starts[i]! && day < starts[i + 1]!);
  const leapYear = lunations.length - 1 === 13;
  let leapFound = false;
  let number = 11;
  const months: ChineseMonth[] = [];
  for (let i = 0; i < lunations.length - 1; i++) {
    const leap = leapYear && !leapFound && i > 0 && !holds(i);
    if (leap) leapFound = true;
    else if (i > 0) number = number === 12 ? 1 : number + 1;
    months.push({ start: starts[i]!, number, leap });
  }
  return months;
}

/** The first day of the Chinese year that begins in this Gregorian year (Spring Festival). */
export function springFestival(year: number): number {
  return chineseSui(year).find((month) => month.number === 1 && !month.leap)!.start;
}

/** The Chinese date of a JDN: the sui that holds it, then the month and day. */
export function jdnToChinese(jdn: number): { year: number; month: number; leap: boolean; day: number } {
  const gregorianYear = Math.floor((jdn - 1721425.5) / 365.2425) + 1;
  for (const year of [gregorianYear, gregorianYear + 1]) {
    const months = chineseSui(year);
    const next = chineseSui(year + 1)[0]!.start;
    const index = months.findIndex((month, i) => jdn >= month.start && jdn < (months[i + 1]?.start ?? next));
    if (index < 0) continue;
    const month = months[index]!;
    const newYear = months.find((item) => item.number === 1 && !item.leap)!.start;
    return {
      year: jdn >= newYear ? year : year - 1,
      month: month.number,
      leap: month.leap,
      day: jdn - month.start + 1,
    };
  }
  throw new Error('chineseYear');
}

/** Qingming: the day the sun reaches 15 degrees (early April). */
export const qingming = (year: number): number => termDay(15, year, 4, 4);

/** Heavenly stem (0 to 9) and earthly branch (0 to 11) of a Chinese year; 4 CE was jiazi. */
export const yearStemBranch = (year: number): { stem: number; branch: number } => ({
  stem: mod(year - 4, 10),
  branch: mod(year - 4, 12),
});

/** The sexagenary day: 0 is jiazi. 1 January 2000 (JDN 2451545) was wuwu, number 54. */
export const daySexagenary = (jdn: number): number => mod(jdn + 49, 60);

/** The JDN of a Chinese date. Months 11 and 12 of a Chinese year fall in the next Gregorian year's sui. */
export function chineseToJdn(year: number, month: number, leap: boolean, day: number): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error('month');
  const sui = chineseSui(month >= 11 ? year + 1 : year);
  // A sui opens with months 11 and 12 of the year before, then months 1 to 10 of its own year.
  const own = sui.findIndex((item) => item.number === month && item.leap === leap);
  if (own < 0) throw new Error('month');
  const start = sui[own]!.start;
  const end = sui[own + 1]?.start ?? chineseSui((month >= 11 ? year + 1 : year) + 1)[0]!.start;
  if (!Number.isInteger(day) || day < 1 || day > end - start) throw new Error('day');
  return start + day - 1;
}
