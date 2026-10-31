// The Julian Day Number core: whole days counted from noon, 1 January 4713 BCE (Julian). Every calendar converts
// to and from it. Gregorian and Julian dates use the integer algorithms of Fliegel and Van Flandern, written here
// with floor so they hold for years before 1 CE (astronomical numbering: 1 BCE is year 0). Errors are codes under
// kitHumanities.calendars.errors.

export interface Ymd {
  year: number;
  month: number;
  day: number;
}

const floor = Math.floor;
/** The remainder with the sign of the divisor, so -1 mod 7 is 6. */
export const mod = (a: number, b: number): number => ((a % b) + b) % b;

export const isGregorianLeap = (y: number): boolean => (mod(y, 4) === 0 && mod(y, 100) !== 0) || mod(y, 400) === 0;
export const isJulianLeap = (y: number): boolean => mod(y, 4) === 0;

const LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function monthLength(year: number, month: number, leap: (y: number) => boolean): number {
  return month === 2 && leap(year) ? 29 : LENGTHS[month - 1]!;
}

function check(date: Ymd, leap: (y: number) => boolean): void {
  const { year, month, day } = date;
  if (![year, month, day].every(Number.isInteger)) throw new Error('whole');
  if (Math.abs(year) > 1_000_000) throw new Error('huge');
  if (month < 1 || month > 12) throw new Error('month');
  if (day < 1 || day > monthLength(year, month, leap)) throw new Error('day');
}

export function gregorianToJdn(date: Ymd): number {
  check(date, isGregorianLeap);
  const a = floor((14 - date.month) / 12);
  const y = date.year + 4800 - a;
  const m = date.month + 12 * a - 3;
  return date.day + floor((153 * m + 2) / 5) + 365 * y + floor(y / 4) - floor(y / 100) + floor(y / 400) - 32045;
}

export function julianToJdn(date: Ymd): number {
  check(date, isJulianLeap);
  const a = floor((14 - date.month) / 12);
  const y = date.year + 4800 - a;
  const m = date.month + 12 * a - 3;
  return date.day + floor((153 * m + 2) / 5) + 365 * y + floor(y / 4) - 32083;
}

export function jdnToGregorian(jdn: number): Ymd {
  const a = jdn + 32044;
  const b = floor((4 * a + 3) / 146097);
  const c = a - floor((146097 * b) / 4);
  const d = floor((4 * c + 3) / 1461);
  const e = c - floor((1461 * d) / 4);
  const m = floor((5 * e + 2) / 153);
  return {
    day: e - floor((153 * m + 2) / 5) + 1,
    month: m + 3 - 12 * floor(m / 10),
    year: 100 * b + d - 4800 + floor(m / 10),
  };
}

export function jdnToJulian(jdn: number): Ymd {
  const c = jdn + 32082;
  const d = floor((4 * c + 3) / 1461);
  const e = c - floor((1461 * d) / 4);
  const m = floor((5 * e + 2) / 153);
  return { day: e - floor((153 * m + 2) / 5) + 1, month: m + 3 - 12 * floor(m / 10), year: d - 4800 + floor(m / 10) };
}

/** 0 for Sunday through 6 for Saturday. */
export const weekday = (jdn: number): number => mod(jdn + 1, 7);

export const dayOfYear = (jdn: number): number => {
  const { year } = jdnToGregorian(jdn);
  return jdn - gregorianToJdn({ year, month: 1, day: 1 }) + 1;
};

/** The ISO 8601 week: weeks start on Monday, and week 1 holds the year's first Thursday. */
export function isoWeek(jdn: number): { year: number; week: number; day: number } {
  const day = mod(jdn, 7) + 1; // 1 for Monday through 7 for Sunday
  const thursday = jdn - day + 4;
  const year = jdnToGregorian(thursday).year;
  const first = gregorianToJdn({ year, month: 1, day: 1 });
  return { year, week: floor((thursday - first) / 7) + 1, day };
}

/** Western Easter as a Gregorian date, by the anonymous Gregorian algorithm (Meeus, Jones, Butcher). */
export function westernEaster(year: number): Ymd {
  const a = mod(year, 19);
  const b = floor(year / 100);
  const c = mod(year, 100);
  const d = floor(b / 4);
  const e = mod(b, 4);
  const f = floor((b + 8) / 25);
  const g = floor((b - f + 1) / 3);
  const h = mod(19 * a + b - d - g + 15, 30);
  const i = floor(c / 4);
  const k = mod(c, 4);
  const l = mod(32 + 2 * e + 2 * i - h - k, 7);
  const m = floor((a + 11 * h + 22 * l) / 451);
  const month = floor((h + l - 7 * m + 114) / 31);
  return { year, month, day: mod(h + l - 7 * m + 114, 31) + 1 };
}

/** Orthodox Easter by the Julian computus, as a Julian date. */
export function julianEaster(year: number): Ymd {
  const d = mod(19 * mod(year, 19) + 15, 30);
  const e = mod(2 * mod(year, 4) + 4 * mod(year, 7) - d + 34, 7);
  return { year, month: floor((d + e + 114) / 31), day: mod(d + e + 114, 31) + 1 };
}
