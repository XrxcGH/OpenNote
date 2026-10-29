// The arithmetic calendars and counts. Coptic and Ethiopian have twelve months of 30 days and a short thirteenth.
// The French Republican calendar uses the Romme leap rule, and the Indian national calendar starts in March.
// Egyptian and Armenian civil years have 365 days. Also here: the Maya Long Count and Calendar Round (GMT
// correlation 584283), Roman Kalends, Nones, and Ides with years from the founding of Rome, Olympiads, and eras.
import { gregorianToJdn, isGregorianLeap, isJulianLeap, jdnToGregorian, mod, monthLength } from './jdn';
import type { Ymd } from './jdn';

const floor = Math.floor;

/** Coptic and Ethiopian: the day before 1 Thout (Meskerem) of year 1. */
export const NILE_EPOCHS = { coptic: 1825029, ethiopian: 1724220 } as const;
export type Nile = keyof typeof NILE_EPOCHS;

export function nileToJdn(kind: Nile, year: number, month: number, day: number): number {
  if (!Number.isInteger(year) || year < 1) throw new Error('positiveYear');
  if (!Number.isInteger(month) || month < 1 || month > 13) throw new Error('month');
  const last = month < 13 ? 30 : mod(year, 4) === 3 ? 6 : 5;
  if (!Number.isInteger(day) || day < 1 || day > last) throw new Error('day');
  return NILE_EPOCHS[kind] + 365 * (year - 1) + floor(year / 4) + 30 * (month - 1) + day;
}

export function jdnToNile(kind: Nile, jdn: number): Ymd {
  const year = floor((4 * (jdn - NILE_EPOCHS[kind] - 1) + 1463) / 1461);
  if (year < 1) throw new Error('beforeEpoch');
  const first = nileToJdn(kind, year, 1, 1);
  const month = floor((jdn - first) / 30) + 1;
  return { year, month, day: jdn - first - 30 * (month - 1) + 1 };
}

/** French Republican: 1 Vendémiaire year 1 was 22 September 1792. */
const REPUBLICAN_EPOCH = 2375839;
export const republicanLeap = (year: number): boolean =>
  mod(year, 4) === 0 && (mod(year, 100) !== 0 || mod(year, 400) === 0) && mod(year, 4000) !== 0;
const leapsBefore = (year: number): number =>
  floor((year - 1) / 4) - floor((year - 1) / 100) + floor((year - 1) / 400) - floor((year - 1) / 4000);

export function republicanToJdn(year: number, month: number, day: number): number {
  if (!Number.isInteger(year) || year < 1) throw new Error('positiveYear');
  if (!Number.isInteger(month) || month < 1 || month > 13) throw new Error('month');
  const last = month < 13 ? 30 : republicanLeap(year) ? 6 : 5;
  if (!Number.isInteger(day) || day < 1 || day > last) throw new Error('day');
  return REPUBLICAN_EPOCH + 365 * (year - 1) + leapsBefore(year) + 30 * (month - 1) + day;
}

export function jdnToRepublican(jdn: number): Ymd {
  let year = floor((jdn - REPUBLICAN_EPOCH) / 365.2425) + 1;
  if (year < 1) throw new Error('beforeEpoch');
  while (year > 1 && republicanToJdn(year, 1, 1) > jdn) year -= 1;
  while (republicanToJdn(year + 1, 1, 1) <= jdn) year += 1;
  const days = jdn - republicanToJdn(year, 1, 1);
  return { year, month: floor(days / 30) + 1, day: (days % 30) + 1 };
}

/** Indian national (Saka): 1 Chaitra is 22 March, or 21 March in a Gregorian leap year; year = Gregorian − 78. */
export function sakaToJdn(year: number, month: number, day: number): number {
  const gregorian = year + 78;
  const leap = isGregorianLeap(gregorian);
  const lengths = [leap ? 31 : 30, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 30];
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error('month');
  if (!Number.isInteger(day) || day < 1 || day > lengths[month - 1]!) throw new Error('day');
  const start = gregorianToJdn({ year: gregorian, month: 3, day: leap ? 21 : 22 });
  return start + lengths.slice(0, month - 1).reduce((sum, n) => sum + n, 0) + day - 1;
}

export function jdnToSaka(jdn: number): Ymd {
  const g = jdnToGregorian(jdn).year;
  const year = jdn >= sakaToJdn(g - 78, 1, 1) ? g - 78 : g - 79;
  let rest = jdn - sakaToJdn(year, 1, 1);
  let month = 1;
  const leap = isGregorianLeap(year + 78);
  const lengths = [leap ? 31 : 30, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 30];
  while (rest >= lengths[month - 1]!) rest -= lengths[month++ - 1]!;
  return { year, month, day: rest + 1 };
}

/** Egyptian civil (era of Nabonassar, from 26 February 747 BCE Julian) and Armenian civil (from 11 July 552). */
export const WANDERING_EPOCHS = { egyptian: 1448638, armenian: 1922868 } as const;
export type Wandering = keyof typeof WANDERING_EPOCHS;

export function jdnToWandering(kind: Wandering, jdn: number): Ymd {
  const days = jdn - WANDERING_EPOCHS[kind];
  if (days < 0) throw new Error('beforeEpoch');
  const rest = mod(days, 365);
  return { year: floor(days / 365) + 1, month: floor(rest / 30) + 1, day: (rest % 30) + 1 };
}

/** Maya: the Long Count and the Calendar Round. The tzolkin has a number and a name; the haab has a day and a month. */
export const MAYA_CORRELATION = 584283;
export interface Maya {
  longCount: number[];
  tzolkin: { number: number; name: number };
  haab: { day: number; month: number };
}

export function jdnToMaya(jdn: number): Maya {
  const days = jdn - MAYA_CORRELATION;
  if (days < 0) throw new Error('beforeEpoch');
  const units = [144000, 7200, 360, 20, 1];
  let rest = days;
  const longCount = units.map((unit) => {
    const digit = floor(rest / unit);
    rest -= digit * unit;
    return digit;
  });
  const haab = mod(days + 348, 365);
  return {
    longCount,
    tzolkin: { number: mod(days + 3, 13) + 1, name: mod(days + 19, 20) },
    haab: { day: haab % 20, month: floor(haab / 20) },
  };
}

export function mayaToJdn(longCount: readonly number[]): number {
  const units = [144000, 7200, 360, 20, 1];
  if (longCount.length !== 5 || longCount.some((digit) => !Number.isInteger(digit) || digit < 0))
    throw new Error('maya');
  if (longCount.slice(1).some((digit, i) => digit >= (i === 2 ? 18 : 20))) throw new Error('maya');
  return MAYA_CORRELATION + longCount.reduce((sum, digit, i) => sum + digit * units[i]!, 0);
}

/** Roman numerals for 1 to 3999. */
export function roman(value: number): string {
  if (!Number.isInteger(value) || value < 1 || value > 3999) throw new Error('roman');
  const marks: [number, string][] = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let rest = value;
  let out = '';
  for (const [size, mark] of marks)
    while (rest >= size) {
      out += mark;
      rest -= size;
    }
  return out;
}

export interface RomanDay {
  /** 'kalends', 'nones', or 'ides' */
  anchor: 'kalends' | 'nones' | 'ides';
  /** The month the anchor belongs to, 1 to 12. */
  month: number;
  /** 1 on the day itself, 2 for the day before (pridie), and so on, counted inclusively. */
  count: number;
  /** The doubled sixth day before the Kalends of March in a leap year. */
  bis: boolean;
}

/** The Roman name of a day of the Julian calendar: counted back, inclusively, to the next Kalends, Nones, or Ides. */
export function romanDay(date: Ymd): RomanDay {
  const { year, month, day } = date;
  const long = [3, 5, 7, 10].includes(month);
  const nones = long ? 7 : 5;
  const ides = long ? 15 : 13;
  if (day === 1) return { anchor: 'kalends', month, count: 1, bis: false };
  if (day <= nones) return { anchor: 'nones', month, count: nones - day + 1, bis: false };
  if (day <= ides) return { anchor: 'ides', month, count: ides - day + 1, bis: false };
  const next = month === 12 ? 1 : month + 1;
  if (month === 2 && isJulianLeap(year)) {
    // In a leap year 24 February is the doubled day; days before it count as in a common February.
    if (day === 24) return { anchor: 'kalends', month: 3, count: 6, bis: true };
    return { anchor: 'kalends', month: 3, count: (day > 24 ? 29 : 28) - day + 2, bis: false };
  }
  return { anchor: 'kalends', month: next, count: monthLength(year, month, isJulianLeap) - day + 2, bis: false };
}

/** Years from the founding of Rome (753 BCE): an astronomical year plus 753. */
export const abUrbeCondita = (year: number): number => year + 753;

/** The Olympiad and its year, counting from midsummer 776 BCE, by calendar year (an approximation). */
export function olympiad(year: number): { olympiad: number; year: number } {
  const since = year + 775;
  if (since < 0) throw new Error('beforeEpoch');
  return { olympiad: floor(since / 4) + 1, year: mod(since, 4) + 1 };
}

export interface Era {
  name: string;
  /** The JDN of its first day. */
  start: number;
}

/** Japanese eras from Meiji, with the first day of each (Gregorian). Meiji years count from 1 January 1868. */
export const JAPANESE_ERAS: readonly { key: string; start: Ymd; yearOne: number }[] = [
  { key: 'meiji', start: { year: 1868, month: 10, day: 23 }, yearOne: 1868 },
  { key: 'taisho', start: { year: 1912, month: 7, day: 30 }, yearOne: 1912 },
  { key: 'showa', start: { year: 1926, month: 12, day: 25 }, yearOne: 1926 },
  { key: 'heisei', start: { year: 1989, month: 1, day: 8 }, yearOne: 1989 },
  { key: 'reiwa', start: { year: 2019, month: 5, day: 1 }, yearOne: 2019 },
];

/** The Japanese era of a JDN and its year, or null before Meiji. */
export function japaneseEra(jdn: number): { key: string; year: number } | null {
  const era = [...JAPANESE_ERAS].reverse().find((item) => gregorianToJdn(item.start) <= jdn);
  if (!era) return null;
  return { key: era.key, year: jdnToGregorian(jdn).year - era.yearOne + 1 };
}

/** The Japanese imperial year (kōki): Gregorian + 660. */
export const imperialYear = (gregorianYear: number): number => gregorianYear + 660;

/** Reads an era table: one era a line, its first day (a Gregorian date, YYYY-MM-DD) and its name. */
export function parseEras(text: string): Era[] {
  const eras = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      const match = /^(-?\d{1,6})-(\d{1,2})-(\d{1,2})\s*[,\t ]\s*(.+)$/.exec(line);
      if (!match) throw new Error('eraLine');
      const start = gregorianToJdn({ year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) });
      return { name: match[4]!.trim(), start };
    });
  return eras.sort((a, b) => a.start - b.start);
}

/** The era of a JDN in a table and the year in it (the year of the start is year 1), or null before the first. */
export function eraOf(eras: readonly Era[], jdn: number): { name: string; year: number } | null {
  const era = [...eras].reverse().find((item) => item.start <= jdn);
  if (!era) return null;
  return { name: era.name, year: jdnToGregorian(jdn).year - jdnToGregorian(era.start).year + 1 };
}
