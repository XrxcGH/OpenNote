// Historical dates for timelines. Inside, a year is astronomical: 1 BCE is year 0 and 44 BCE is year -43, so a
// duration is a plain difference. Outside, years are shown the historian's way, with no year zero. A date keeps
// how precise it is (day to millennium, or deep time before present) and its uncertainty, as the range of years it
// can mean. Errors are codes under kitHumanities.timeline.errors.

export type Precision = 'day' | 'month' | 'year' | 'decade' | 'century' | 'millennium' | 'deep';
export type Qualifier = 'on' | 'before' | 'after';

export interface TimeDate {
  /** The central value, as an astronomical year with a fraction for the month and day. */
  mid: number;
  /** The earliest and latest years the date can mean. */
  low: number;
  high: number;
  precision: Precision;
  approx: boolean;
  qualifier: Qualifier;
  /** How the text was read, for the steps. */
  read: 'bce' | 'ce' | 'astronomical' | 'bp' | 'iso';
}

/** Radiocarbon years before present count back from 1950. */
export const PRESENT = 1950;
/** The spread given to a date marked c. or circa when no ± is typed. */
export const CIRCA = 25;
export const MAX_YEARS = 1e10;

/** The year shown for an astronomical year: 0 is 1 BCE, -1 is 2 BCE. */
export function historianYear(year: number): { year: number; bce: boolean } {
  return year <= 0 ? { year: 1 - year, bce: true } : { year, bce: false };
}

/** The astronomical year of a historian's year. There is no year 0 in either era. */
export function astronomicalYear(year: number, bce: boolean): number {
  if (!Number.isInteger(year) || year < 1) throw new Error('yearZero');
  return bce ? 1 - year : year;
}

/** Years before present (1950) for an astronomical year. */
export const beforePresent = (year: number): number => PRESENT - year;

const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const leap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

function fraction(year: number, month: number, day: number): number {
  if (month < 1 || month > 12) throw new Error('month');
  const length = month === 2 && leap(year) ? 29 : DAYS[month - 1]!;
  if (day < 1 || day > length) throw new Error('day');
  let before = day - 1;
  for (let m = 1; m < month; m++) before += m === 2 && leap(year) ? 29 : DAYS[m - 1]!;
  return before / (leap(year) ? 366 : 365);
}

const UNITS: Record<string, number> = { ga: 1e9, ma: 1e6, ka: 1e3 };
const ORDINAL = /^(\d+)(?:st|nd|rd|th)\s+(century|millennium)(?:\s+(bce|bc|b\.c\.|ce|ad|a\.d\.))?$/;

interface Core {
  low: number;
  high: number;
  mid: number;
  precision: Precision;
  read: TimeDate['read'];
}

const isBce = (era: string | undefined) => era !== undefined && era.startsWith('b');

function span(low: number, high: number, precision: Precision, read: TimeDate['read']): Core {
  return { low, high, mid: (low + high) / 2, precision, read };
}

function readCore(text: string): Core {
  const deep = /^(\d+(?:\.\d+)?)\s*(ga|ma|ka)$/.exec(text);
  if (deep) {
    const year = PRESENT - Number(deep[1]) * UNITS[deep[2]!]!;
    return { low: year, high: year, mid: year, precision: 'deep', read: 'bp' };
  }
  const bp = /^(\d+(?:\.\d+)?)\s*(?:cal\s+)?bp$/.exec(text);
  if (bp) {
    const year = PRESENT - Number(bp[1]);
    return { low: year, high: year, mid: year, precision: 'deep', read: 'bp' };
  }
  const ordinal = ORDINAL.exec(text);
  if (ordinal) {
    const n = Number(ordinal[1]);
    if (n < 1) throw new Error('yearZero');
    const size = ordinal[2] === 'century' ? 100 : 1000;
    const precision: Precision = size === 100 ? 'century' : 'millennium';
    // The 5th century BCE runs from 500 BCE to 401 BCE; the 5th century CE from 401 to 500.
    if (isBce(ordinal[3])) return span(1 - n * size, 1 - ((n - 1) * size + 1), precision, 'bce');
    return span((n - 1) * size + 1, n * size, precision, 'ce');
  }
  const decade = /^(\d+)0s(?:\s+(bce|bc|ce|ad))?$/.exec(text);
  if (decade) {
    const start = Number(decade[1]) * 10;
    const size = start % 100 === 0 && start > 0 ? 100 : 10;
    const precision: Precision = size === 100 ? 'century' : 'decade';
    if (isBce(decade[2])) {
      if (start === 0) throw new Error('yearZero');
      return span(1 - (start + size - 1), 1 - start, precision, 'bce');
    }
    return span(Math.max(start, 1), start + size - 1, precision, 'ce');
  }
  const iso = /^(-?\d{1,6})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(text);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = iso[3] === undefined ? 1 : Number(iso[3]);
    const at = year + fraction(year, month, day);
    return { low: at, high: at, mid: at, precision: iso[3] === undefined ? 'month' : 'day', read: 'iso' };
  }
  const era = /^(?:(ad|a\.d\.)\s*)?(\d+)\s*(bce|bc|b\.c\.|ce|ad|a\.d\.)?$/.exec(text);
  if (era) {
    const year = Number(era[2]);
    const bce = isBce(era[3]);
    const read = bce ? 'bce' : era[1] !== undefined || era[3] !== undefined ? 'ce' : 'astronomical';
    // A plain 0 is the astronomical year 0, which is 1 BCE; 0 BCE and 0 CE do not exist.
    const value = year === 0 && read === 'astronomical' ? 0 : astronomicalYear(year, bce);
    return { low: value, high: value, mid: value, precision: 'year', read };
  }
  const negative = /^-(\d+)$/.exec(text);
  if (negative) {
    const value = -Number(negative[1]);
    return { low: value, high: value, mid: value, precision: 'year', read: 'astronomical' };
  }
  throw new Error('date');
}

/**
 * Reads a date: 1603, 1603-03-24, 44 BCE, AD 14, -43 (astronomical), the 1960s, the 1600s, 5th century BCE,
 * 2nd millennium BCE, 4.5 Ga, 66 Ma, 12 ka, 11700 BP, with c. or circa in front, before or after in front, and
 * ± or +/- and a number of years after.
 */
export function parseDate(input: string): TimeDate {
  let text = input.trim().toLowerCase().replace(/−/g, '-').replace(/\s+/g, ' ');
  if (text === '') throw new Error('empty');
  let approx = false;
  let qualifier: Qualifier = 'on';
  let plusMinus: number | null = null;
  const lead = /^(c\.|ca\.|circa|c|~)\s*/.exec(text);
  if (lead) {
    approx = true;
    text = text.slice(lead[0].length);
  }
  const side = /^(before|after)\s+/.exec(text);
  if (side) {
    qualifier = side[1] as Qualifier;
    text = text.slice(side[0].length);
  }
  const spread = /\s*(?:±|\+\/-|\+-)\s*(\d+(?:\.\d+)?)\s*(ga|ma|ka)?$/.exec(text);
  if (spread) {
    plusMinus = Number(spread[1]) * (spread[2] ? UNITS[spread[2]]! : 1);
    text = text.slice(0, spread.index).trim();
  }
  text = text.replace(/^the\s+/, '');
  const core = readCore(text);
  let { low, high } = core;
  const extra = plusMinus ?? (approx ? CIRCA : 0);
  low -= extra;
  high += extra;
  if (Math.abs(low) > MAX_YEARS || Math.abs(high) > MAX_YEARS) throw new Error('huge');
  return { ...core, low, high, approx: approx || plusMinus !== null, qualifier };
}

/** The years from one date to the next, in astronomical years; negative when the end comes first. */
export const duration = (start: TimeDate, end: TimeDate): number => end.mid - start.mid;

export interface Overlap {
  start: number;
  end: number;
  length: number;
}

/** Where two spans overlap, or null when they do not. Spans that only touch overlap for zero years. */
export function overlap(a: readonly [number, number], b: readonly [number, number]): Overlap | null {
  const start = Math.max(Math.min(...a), Math.min(...b));
  const end = Math.min(Math.max(...a), Math.max(...b));
  return end < start ? null : { start, end, length: end - start };
}
