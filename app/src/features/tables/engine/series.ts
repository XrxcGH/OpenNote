// Fill series (DESIGN.md section 13.6): what the fill handle writes past the end of a run of cells. A pure function
// of the cells' text, so it needs no editor. The rules are the usual spreadsheet ones, from their documented
// behavior. Numbers continue as a line. A date moves by the unit its cells show. A month or weekday name cycles.
// Text that ends in a number counts up. Anything else repeats.
import { daysToIso, daysToYmd, parseIsoDate, ymdToDays, weekdayOf } from './dates';
import { numberToText, parseCanonicalNumber } from './values';

export type DateUnit = 'day' | 'weekday' | 'month' | 'year';

export interface SeriesOptions {
  /** The step, when the person names one. Otherwise it comes from the cells. */
  step?: number;
  /** A growth series multiplies by the step (or the ratio of the first two cells) instead of adding. */
  growth?: boolean;
  /** The unit of a date series. Otherwise it comes from the cells. */
  unit?: DateUnit;
  /** Copy the cells again and again, with no series. */
  copy?: boolean;
  /** The names of months and weekdays, in the person's language. English by default. */
  names?: { months: readonly string[][]; weekdays: readonly string[][] };
}

const ENGLISH_MONTHS = [
  [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
  ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
];
const ENGLISH_WEEKDAYS = [
  ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
];

/** The names of months and weekdays, long form first, then the short form. */
export function namesFor(locale: string): NonNullable<SeriesOptions['names']> {
  try {
    const month = (style: 'long' | 'short') =>
      Array.from({ length: 12 }, (_, i) =>
        new Intl.DateTimeFormat(locale, { month: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2021, i, 15))),
      );
    // 2021-08-01 was a Sunday.
    const day = (style: 'long' | 'short') =>
      Array.from({ length: 7 }, (_, i) =>
        new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2021, 7, 1 + i))),
      );
    return { months: [month('long'), month('short')], weekdays: [day('long'), day('short')] };
  } catch {
    return { months: ENGLISH_MONTHS, weekdays: ENGLISH_WEEKDAYS };
  }
}

/** Repeats the cells to fill `count` cells. */
function repeat(source: readonly string[], count: number): string[] {
  return Array.from({ length: count }, (_, i) => source[i % source.length]);
}

const same = (a: readonly number[]): boolean => a.every((n) => Math.abs(n - a[0]) < 1e-9);

function differences(values: readonly number[]): number[] {
  return values.slice(1).map((n, i) => n - values[i]);
}

/** The next numbers of a line, by the least squares fit of the cells when their steps differ (a linear trend). */
function line(values: readonly number[], count: number, step: number | undefined): number[] {
  const last = values[values.length - 1];
  if (step !== undefined) return Array.from({ length: count }, (_, i) => last + step * (i + 1));
  if (values.length === 1) return Array.from({ length: count }, () => values[0]);
  const diffs = differences(values);
  if (same(diffs)) return Array.from({ length: count }, (_, i) => last + diffs[0] * (i + 1));
  const n = values.length;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let top = 0;
  let bottom = 0;
  values.forEach((y, x) => {
    top += (x - meanX) * (y - meanY);
    bottom += (x - meanX) ** 2;
  });
  const slope = top / bottom;
  return Array.from({ length: count }, (_, i) => meanY + slope * (n + i - meanX));
}

function growth(values: readonly number[], count: number, step: number | undefined): number[] {
  const last = values[values.length - 1];
  const ratio = step ?? (values.length > 1 && values[0] !== 0 ? values[1] / values[0] : 1);
  const out: number[] = [];
  let at = last;
  for (let i = 0; i < count; i++) {
    at *= ratio;
    out.push(at);
  }
  return out;
}

// ---- Dates

/** A date `months` after another, clamped to the end of a shorter month: January 31 plus one month is February 28. */
function addMonths(days: number, months: number, dayOfMonth: number): number {
  const { y, m } = daysToYmd(days);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  if (!(year >= 1 && year <= 9999)) return NaN;
  for (let d = dayOfMonth; d >= 1; d--) {
    const found = ymdToDays(year, month, d);
    if (found !== null) return found;
  }
  return days;
}

/** The weekday that is `n` working days from a day, skipping Saturday and Sunday. Whole weeks jump; the rest walks. */
function addWeekdays(days: number, n: number): number {
  const sign = n < 0 ? -1 : 1;
  const whole = Math.floor(Math.abs(n));
  let at = Math.floor(days);
  const w = weekdayOf(at);
  // From a weekend, count from the weekday it follows (going forward) or precedes (going back).
  if (w === 6) at += sign > 0 ? -1 : 2;
  else if (w === 0) at += sign > 0 ? -2 : 1;
  at += sign * 7 * Math.floor(whole / 5);
  for (let left = whole % 5; left > 0; left--) {
    do at += sign;
    while (weekdayOf(at) === 0 || weekdayOf(at) === 6);
  }
  return at;
}

/** The unit and step the cells show: a whole number of years, months, or days apart. */
function dateStep(days: readonly number[]): { unit: DateUnit; step: number } {
  if (days.length < 2) return { unit: 'day', step: 1 };
  const first = daysToYmd(days[0]);
  const monthGaps = days.slice(1).map((d, i) => {
    const a = daysToYmd(days[i]);
    const b = daysToYmd(d);
    return (b.y - a.y) * 12 + (b.m - a.m);
  });
  const lastDay = (ymd: { y: number; m: number; d: number }) => ymdToDays(ymd.y, ymd.m, ymd.d + 1) === null;
  const sameDay = days.every((d) => {
    const ymd = daysToYmd(d);
    return ymd.d === first.d || (lastDay(ymd) && ymd.d < first.d);
  });
  if (sameDay && same(monthGaps) && monthGaps[0] !== 0) {
    return monthGaps[0] % 12 === 0 ? { unit: 'year', step: monthGaps[0] / 12 } : { unit: 'month', step: monthGaps[0] };
  }
  const gaps = differences(days);
  return { unit: 'day', step: same(gaps) ? gaps[0] : (days[days.length - 1] - days[0]) / (days.length - 1) };
}

const MIN_DAY = ymdToDays(1, 1, 1) ?? 0;
const MAX_DAY = ymdToDays(9999, 12, 31) ?? 0;

/** The dates that follow, or null when one would fall outside the years 1 to 9999. */
function dateSeries(days: readonly number[], count: number, options: SeriesOptions): string[] | null {
  const shown = dateStep(days);
  const unit = options.unit ?? shown.unit;
  // A step from the cells keeps its unit; a named unit with no step moves by one.
  const step = options.step ?? (options.unit && options.unit !== shown.unit ? 1 : shown.step);
  const last = days[days.length - 1];
  const dayOfMonth = daysToYmd(days[0]).d;
  const out: string[] = [];
  for (let i = 1; i <= count; i++) {
    const n = step * i;
    if (!Number.isFinite(n)) return null;
    let next: number;
    if (unit === 'month') next = addMonths(last, n, dayOfMonth);
    else if (unit === 'year') next = addMonths(last, n * 12, dayOfMonth);
    else if (unit === 'weekday') next = addWeekdays(last, n);
    else next = last + n;
    // A date outside 0001-01-01 to 9999-12-31 has no valid text.
    if (!Number.isFinite(next) || next < MIN_DAY || next > MAX_DAY) return null;
    out.push(daysToIso(next));
  }
  return out;
}

// ---- Names

/** How a name was written, so the next one is written the same way. */
function recase(name: string, like: string): string {
  if (like === like.toUpperCase() && like.length > 1) return name.toUpperCase();
  if (like === like.toLowerCase()) return name.toLowerCase();
  return name;
}

interface Cycle {
  list: readonly string[];
  index: number;
}

function findName(text: string, lists: readonly (readonly string[])[]): Cycle | null {
  const lower = text.trim().toLowerCase();
  for (const list of lists) {
    const index = list.findIndex((name) => name.toLowerCase() === lower);
    if (index >= 0) return { list, index };
  }
  return null;
}

function nameSeries(
  source: readonly string[],
  lists: readonly (readonly string[])[],
  count: number,
  step: number | undefined,
): string[] | null {
  const found = source.map((text) => findName(text, lists));
  if (found.some((one) => !one || one.list !== found[0]?.list)) return null;
  const cycles = found as Cycle[];
  const size = cycles[0].list.length;
  const gaps = differences(cycles.map((c) => c.index)).map((g) => ((g % size) + size) % size);
  const by = step ?? (gaps.length > 0 && same(gaps) ? gaps[0] : 1);
  const last = cycles[cycles.length - 1].index;
  const like = source[source.length - 1];
  return Array.from({ length: count }, (_, i) =>
    recase(cycles[0].list[(((last + by * (i + 1)) % size) + size) % size], like),
  );
}

// ---- Text that ends in a number

interface Counted {
  prefix: string;
  digits: string;
  suffix: string;
}

const COUNTED = /^(.*?)(\d+)(\D*)$/;

function counted(text: string): Counted | null {
  const m = COUNTED.exec(text);
  return m && m[1] + m[3] !== '' ? { prefix: m[1], digits: m[2], suffix: m[3] } : null;
}

const ORDINAL = /^(st|nd|rd|th)$/i;

/** The ending of an ordinal: 1st, 2nd, 3rd, 4th, 11th, 21st. Written in the case of the cell's own ending. */
function ordinalSuffix(n: number, like: string): string {
  const a = Math.abs(n);
  const end = a % 100 >= 11 && a % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][a % 10] ?? 'th');
  return like === like.toUpperCase() ? end.toUpperCase() : end;
}

function countedSeries(source: readonly string[], count: number, options: SeriesOptions): string[] | null {
  const parts = source.map(counted);
  if (parts.some((p) => !p || p.prefix !== parts[0]?.prefix || p.suffix !== parts[0]?.suffix)) return null;
  const list = parts as Counted[];
  const numbers = list.map((p) => Number(p.digits));
  if (numbers.some((n) => !Number.isSafeInteger(n))) return null;
  const next = options.growth
    ? growth(numbers, count, options.step)
    : line(numbers, count, options.step ?? (numbers.length === 1 ? 1 : undefined));
  const last = list[list.length - 1];
  if (next.some((n) => !Number.isSafeInteger(Math.round(n)))) return null;
  const width = last.digits.startsWith('0') ? last.digits.length : 0;
  const ordinal = ORDINAL.test(last.suffix);
  return next.map((n) => {
    const whole = Math.round(n);
    const digits = String(Math.abs(whole)).padStart(width, '0');
    const suffix = ordinal ? ordinalSuffix(whole, last.suffix) : last.suffix;
    return `${last.prefix}${whole < 0 ? '-' : ''}${digits}${suffix}`;
  });
}

const MONEY = /^([$€£¥]?)(-?\d+(?:\.\d+)?)(%?)$/;

/** Numbers with a currency or percent sign: one is copied, a pair steps. The sign is kept. */
function moneySeries(
  texts: readonly string[],
  source: readonly string[],
  count: number,
  options: SeriesOptions,
): string[] | null {
  const parts = texts.map((t) => MONEY.exec(t));
  if (parts.some((m) => !m || m[1] + m[3] === '' || m[1] !== parts[0]?.[1] || m[3] !== parts[0]?.[3])) return null;
  if (parts.length === 1 && options.step === undefined) return repeat(source, count);
  const values = parts.map((m) => Number((m as RegExpExecArray)[2]));
  const next = options.growth ? growth(values, count, options.step) : line(values, count, options.step);
  if (next.some((n) => !Number.isFinite(n))) return repeat(source, count);
  const [, pre, , post] = parts[0] as RegExpExecArray;
  return next.map((n) => `${pre}${numberToText(n)}${post}`);
}

/**
 * The `count` cells that follow `source` (cells in the order they are on the sheet). Dragging up or left passes
 * the cells in reverse order, and the first result is then the cell next to the first source cell.
 */
export function continueSeries(source: readonly string[], count: number, options: SeriesOptions = {}): string[] {
  if (count <= 0 || source.length === 0) return [];
  if (options.copy) return repeat(source, count);
  const texts = source.map((s) => s.trim());
  if (texts.some((t) => t === '')) return repeat(source, count);
  const numbers = texts.map(parseCanonicalNumber);
  if (numbers.every((n): n is number => n !== null)) {
    // One plain number is copied, as a spreadsheet does, unless a step was asked for.
    if (numbers.length === 1 && options.step === undefined) return repeat(source, count);
    const next = options.growth ? growth(numbers, count, options.step) : line(numbers, count, options.step);
    if (next.some((n) => !Number.isFinite(n))) return repeat(source, count);
    // Numbers written with leading zeros keep their width: 001, 002 goes on 003.
    const width = texts.reduce((w, t) => (/^0\d+$/.test(t) ? Math.max(w, t.length) : w), 0);
    return next.map((n) =>
      width > 0 && Number.isInteger(n) && n >= 0 ? String(n).padStart(width, '0') : numberToText(n),
    );
  }
  const money = moneySeries(texts, source, count, options);
  if (money) return money;
  const days = texts.map(parseIsoDate);
  if (days.every((d): d is number => d !== null)) return dateSeries(days, count, options) ?? repeat(source, count);
  const names = options.names ?? { months: ENGLISH_MONTHS, weekdays: ENGLISH_WEEKDAYS };
  const named =
    nameSeries(texts, names.months, count, options.step) ?? nameSeries(texts, names.weekdays, count, options.step);
  if (named) return named;
  return countedSeries(texts, count, options) ?? repeat(source, count);
}
