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
  for (let d = dayOfMonth; d >= 1; d--) {
    const found = ymdToDays(year, month, d);
    if (found !== null) return found;
  }
  return days;
}

/** The weekday that is `n` working days from a day, skipping Saturday and Sunday. */
function addWeekdays(days: number, n: number): number {
  const sign = n < 0 ? -1 : 1;
  let left = Math.abs(n);
  let at = days;
  while (left > 0) {
    at += sign;
    const w = weekdayOf(at);
    if (w !== 0 && w !== 6) left--;
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

function dateSeries(days: readonly number[], count: number, options: SeriesOptions): string[] {
  const shown = dateStep(days);
  const unit = options.unit ?? shown.unit;
  // A step from the cells keeps its unit; a named unit with no step moves by one.
  const step = options.step ?? (options.unit && options.unit !== shown.unit ? 1 : shown.step);
  const last = days[days.length - 1];
  const dayOfMonth = daysToYmd(days[0]).d;
  const out: string[] = [];
  for (let i = 1; i <= count; i++) {
    const n = step * i;
    let next: number;
    if (unit === 'month') next = addMonths(last, n, dayOfMonth);
    else if (unit === 'year') next = addMonths(last, n * 12, dayOfMonth);
    else if (unit === 'weekday') next = addWeekdays(last, n);
    else next = last + n;
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
  const width = last.digits.startsWith('0') ? last.digits.length : 0;
  return next.map((n) => `${last.prefix}${String(Math.max(0, Math.round(n))).padStart(width, '0')}${last.suffix}`);
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
    return next.map((n) => numberToText(n));
  }
  const days = texts.map(parseIsoDate);
  if (days.every((d): d is number => d !== null)) return dateSeries(days, count, options);
  const names = options.names ?? { months: ENGLISH_MONTHS, weekdays: ENGLISH_WEEKDAYS };
  const named =
    nameSeries(texts, names.months, count, options.step) ?? nameSeries(texts, names.weekdays, count, options.step);
  if (named) return named;
  return countedSeries(texts, count, options) ?? repeat(source, count);
}
