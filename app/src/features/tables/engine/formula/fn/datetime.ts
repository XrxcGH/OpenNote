// Date and time functions. Owner: tables:fn-datetime. Dates are serials (days since 1899-12-30), so a date minus a
// date is a number of days, and a time is a fraction of a day. Every rule here comes from the documented behavior of
// the function, not from any other program's code. Where the reference apps differ, fixtures/fn/DIFFERENCES.md says so.

import { dateToSerial, daysToYmd, parseDate, weekdayOf, ymdToSerial } from '../../dates';
import {
  err,
  finish,
  isArray,
  isError,
  parseCanonicalNumber,
  textToNumber,
  toNumber,
  toNumbers,
  toScalar,
  toText,
  type FormulaError,
  type Value,
} from '../../values';
import type { FnSpec2, Param } from './types';

const DAY_SECONDS = 86_400;
/** The last serial a date can have: 9999-12-31. */
const MAX_SERIAL = 2_958_465;
/** The largest day count WORKDAY accepts, so a typo cannot hold the sheet for long. */
const MAX_WORKDAYS = 3_000_000;

const num = (name: string, optional = false, def?: number): Param =>
  optional
    ? { name, kind: 'number', optional: true, ...(def === undefined ? {} : { default: def }) }
    : { name, kind: 'number' };

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  return ymdToSerial(y, m + 1, 1) - ymdToSerial(y, m, 1);
}

/** The whole-day part of a serial. */
const whole = (n: number): number => Math.floor(n);

function dayOfYear(serial: number): number {
  const { y } = daysToYmd(serial);
  return serial - ymdToSerial(y, 1, 1) + 1;
}

/** Seconds into the day, 0 to 86399. Rounded to the second, so 0.75 is exactly 18:00:00. */
function secondsOfDay(n: number): number {
  const total = Math.round((n - Math.floor(n)) * DAY_SECONDS);
  return total % DAY_SECONDS;
}

function datePart(name: string, pick: (ymd: ReturnType<typeof daysToYmd>) => number, example: string): FnSpec2 {
  return {
    name,
    family: 'datetime',
    params: [num('date')],
    run: ([v]) => {
      const n = toNumber(v);
      return typeof n === 'number' ? pick(daysToYmd(n)) : n;
    },
    meta: { signature: `${name}(date)`, example },
  };
}

function timePart(name: string, pick: (seconds: number) => number, example: string): FnSpec2 {
  return {
    name,
    family: 'datetime',
    params: [num('time')],
    run: ([v]) => {
      const n = toNumber(v);
      if (typeof n !== 'number') return n;
      return n < 0 || !inDayRange(n) ? err('NUM') : pick(secondsOfDay(n));
    },
    meta: { signature: `${name}(time)`, example },
  };
}

// ---- Months -------------------------------------------------------------------------------------------------------

/** The date `months` after `start`, with the day kept when the month has it and cut back to the month's end when not. */
function addMonths(start: number, months: number): number {
  const { y, m, d } = daysToYmd(start);
  const index = y * 12 + (m - 1) + months;
  const ny = Math.floor(index / 12);
  const nm = index - ny * 12 + 1;
  return ymdToSerial(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

function endOfMonth(start: number, months: number): number {
  const { y, m } = daysToYmd(start);
  const index = y * 12 + (m - 1) + months;
  const ny = Math.floor(index / 12);
  const nm = index - ny * 12 + 1;
  return ymdToSerial(ny, nm, daysInMonth(ny, nm));
}

function inRange(serial: number): Value {
  return serial < 0 || serial > MAX_SERIAL ? err('NUM') : serial;
}

// ---- Weeks --------------------------------------------------------------------------------------------------------

/** For WEEKDAY: the first day of the week (0 Sunday to 6 Saturday) and the number the first day gets. */
const WEEKDAY_TYPES: Readonly<Record<number, { first: number; base: number }>> = {
  1: { first: 0, base: 1 },
  2: { first: 1, base: 1 },
  3: { first: 1, base: 0 },
  11: { first: 1, base: 1 },
  12: { first: 2, base: 1 },
  13: { first: 3, base: 1 },
  14: { first: 4, base: 1 },
  15: { first: 5, base: 1 },
  16: { first: 6, base: 1 },
  17: { first: 0, base: 1 },
};

/** For WEEKNUM: the first day of the week. Week 1 is the week with January 1. Type 21 is the ISO week. */
const WEEKNUM_TYPES: Readonly<Record<number, number>> = {
  1: 0,
  2: 1,
  11: 1,
  12: 2,
  13: 3,
  14: 4,
  15: 5,
  16: 6,
  17: 0,
};

/** The ISO 8601 week: weeks start on Monday, and week 1 is the week with the year's first Thursday. */
function isoWeek(serial: number): number {
  const monday = (weekdayOf(serial) + 6) % 7; // 0 for Monday
  const thursday = serial - monday + 3;
  return Math.floor((dayOfYear(thursday) - 1) / 7) + 1;
}

// ---- Working days -------------------------------------------------------------------------------------------------

/** Seven flags, Monday first, true for a weekend day; or an error when the code or mask is not valid. */
function weekendFlags(value: Value | undefined): { flags: boolean[] } | FormulaError {
  const v = value === undefined ? 1 : toScalar(value);
  if (isError(v)) return v;
  // Seven characters of 0 and 1 are a mask, Monday first. Other text and logical values are not valid.
  if (typeof v === 'string') {
    if (!/^[01]{7}$/.test(v)) return err('VALUE');
    const flags = [...v].map((c) => c === '1');
    return flags.every(Boolean) ? err('VALUE') : { flags };
  }
  if (typeof v === 'boolean') return err('VALUE');
  const n = toNumber(v);
  if (typeof n !== 'number') return n;
  if (!Number.isInteger(n)) return err('NUM');
  const code = n;
  const flags = Array<boolean>(7).fill(false);
  if (code >= 1 && code <= 7) {
    // Codes 1 to 7 name two days in a row: 1 Saturday and Sunday, 2 Sunday and Monday, and on to 7 Friday and Saturday.
    const first = (code + 4) % 7; // Monday-first index of the first day of the pair
    flags[first] = true;
    flags[(first + 1) % 7] = true;
    return { flags };
  }
  if (code >= 11 && code <= 17) {
    flags[(code - 11 + 6) % 7] = true; // 11 is Sunday, which is index 6 when Monday is 0
    return { flags };
  }
  return err('NUM');
}

/** The holidays as a set of whole-day serials, or the first error. Empty cells are skipped. */
function holidaySet(value: Value | undefined): Set<number> | FormulaError {
  const out = new Set<number>();
  if (value === undefined) return out;
  const items = isArray(value) ? value.data : [toScalar(value)];
  for (const item of items) {
    if (item === null) continue;
    const n = toNumber(item);
    if (typeof n !== 'number') return n;
    if (!inDayRange(n)) return err('NUM');
    out.add(whole(n));
  }
  return out;
}

/** Day serials beyond this are refused, so counting loops stay far below the size where adding 1 stops working. */
const MAX_DAY_SERIAL = 1e8;
const inDayRange = (n: number): boolean => Number.isFinite(n) && Math.abs(n) <= MAX_DAY_SERIAL;

const isOff = (serial: number, flags: boolean[], holidays: Set<number>): boolean =>
  flags[(weekdayOf(serial) + 6) % 7] || holidays.has(serial);

/** Working days from `from` to `to` inclusive, where from <= to. Whole weeks are counted by arithmetic. */
function workingDaysBetween(from: number, to: number, flags: boolean[], holidays: Set<number>): number {
  const perWeek = flags.filter((f) => !f).length;
  const weeks = Math.floor((to - from + 1) / 7);
  let count = weeks * perWeek;
  for (let d = from + weeks * 7; d <= to; d++) if (!flags[(weekdayOf(d) + 6) % 7]) count += 1;
  for (const h of holidays) {
    if (h >= from && h <= to && !flags[(weekdayOf(h) + 6) % 7]) count -= 1;
  }
  return count;
}

/** The DAYS360 method argument as a logical. A number other than 0 is TRUE. Text must be TRUE or FALSE. */
function europeanFlag(v: Value | undefined): boolean | FormulaError {
  if (v === undefined) return false;
  const s = toScalar(v);
  if (isError(s)) return s;
  if (s === null) return false;
  if (typeof s === 'boolean') return s;
  if (typeof s === 'number') return s !== 0;
  const t = s.trim().toUpperCase();
  return t === 'TRUE' ? true : t === 'FALSE' ? false : err('VALUE');
}

function networkdays(args: Value[], withWeekend: boolean): Value {
  const dates = toNumbers([args[0], args[1]]);
  if (!Array.isArray(dates)) return dates;
  const weekend = weekendFlags(withWeekend ? args[2] : 1);
  if ('error' in weekend) return weekend;
  const holidays = holidaySet(withWeekend ? args[3] : args[2]);
  if (!(holidays instanceof Set)) return holidays;
  if (!inDayRange(dates[0]) || !inDayRange(dates[1])) return err('NUM');
  const [a, b] = [whole(dates[0]), whole(dates[1])];
  const count = workingDaysBetween(Math.min(a, b), Math.max(a, b), weekend.flags, holidays);
  return a <= b ? count : -count;
}

function workday(args: Value[], withWeekend: boolean): Value {
  const nums = toNumbers([args[0], args[1]]);
  if (!Array.isArray(nums)) return nums;
  const weekend = weekendFlags(withWeekend ? args[2] : 1);
  if ('error' in weekend) return weekend;
  const holidays = holidaySet(withWeekend ? args[3] : args[2]);
  if (!(holidays instanceof Set)) return holidays;
  const off = holidays;
  if (!inDayRange(nums[0])) return err('NUM');
  let day = whole(nums[0]);
  const steps = Math.trunc(nums[1]);
  if (Math.abs(steps) > MAX_WORKDAYS) return err('NUM');
  const dir = steps < 0 ? -1 : 1;
  let left = Math.abs(steps);
  const perWeek = weekend.flags.filter((f) => !f).length;
  const working = [...off].filter((h) => !weekend.flags[(weekdayOf(h) + 6) % 7]);
  // Whole weeks hold a fixed number of working days, less the holidays inside them, so skip them in one move.
  // Each move leaves at least one working day to find, and the loop ends once the count is small.
  while (left > perWeek) {
    const weeks = Math.floor((left - 1) / perWeek);
    const end = day + dir * weeks * 7;
    const [lo, hi] = dir > 0 ? [day + 1, end] : [end, day - 1];
    const inside = working.filter((h) => h >= lo && h <= hi).length;
    day = end;
    left -= weeks * perWeek - inside;
    // The walk only moves one way, so a day outside the serial range means the result is outside it too.
    if (day < 0 || day > MAX_SERIAL) return err('NUM');
  }
  while (left > 0) {
    day += dir;
    if (day < 0 || day > MAX_SERIAL) return err('NUM');
    if (!isOff(day, weekend.flags, off)) left -= 1;
  }
  return inRange(day);
}

// ---- DATEDIF and the day-count bases ------------------------------------------------------------------------------

function datedif(args: Value[]): Value {
  const dates = toNumbers([args[0], args[1]]);
  if (!Array.isArray(dates)) return dates;
  const unit = toText(args[2]);
  if (typeof unit !== 'string') return unit;
  const [s, e] = [whole(dates[0]), whole(dates[1])];
  if (s > e) return err('NUM');
  const a = daysToYmd(s);
  const b = daysToYmd(e);
  const months = (b.y - a.y) * 12 + (b.m - a.m) - (b.d < a.d ? 1 : 0);
  switch (unit.toUpperCase()) {
    case 'Y':
      return Math.floor(months / 12);
    case 'M':
      return months;
    case 'D':
      return e - s;
    case 'YM':
      return months % 12;
    case 'MD': {
      if (b.d >= a.d) return b.d - a.d;
      // The end day is before the start day, so count from the start day in the month before the end month.
      const prev = b.m === 1 ? { y: b.y - 1, m: 12 } : { y: b.y, m: b.m - 1 };
      return daysInMonth(prev.y, prev.m) - a.d + b.d;
    }
    case 'YD': {
      // Move the start date to the end's year, or the year before when that lands after the end.
      const at = (y: number): number => ymdToSerial(y, a.m, Math.min(a.d, daysInMonth(y, a.m)));
      const moved = at(b.y) <= e ? at(b.y) : at(b.y - 1);
      return e - moved;
    }
    default:
      return err('NUM');
  }
}

/** Days between two dates on a 360-day year of twelve 30-day months, in the US (NASD) or European method. */
function days360(s: number, e: number, european: boolean): number {
  const a = daysToYmd(s);
  const b = daysToYmd(e);
  let d1 = a.d;
  let d2 = b.d;
  if (european) {
    if (d1 === 31) d1 = 30;
    if (d2 === 31) d2 = 30;
  } else {
    const lastFeb = (y: ReturnType<typeof daysToYmd>): boolean => y.m === 2 && y.d === daysInMonth(y.y, 2);
    if (lastFeb(a)) {
      if (lastFeb(b)) d2 = 30;
      d1 = 30;
    }
    if (d2 === 31 && d1 >= 30) d2 = 30;
    if (d1 === 31) d1 = 30;
  }
  return (b.y - a.y) * 360 + (b.m - a.m) * 30 + (d2 - d1);
}

function yearfrac(args: Value[]): Value {
  const nums = toNumbers(args.length < 3 ? [args[0], args[1]] : [args[0], args[1], args[2]]);
  if (!Array.isArray(nums)) return nums;
  const basis = args.length < 3 ? 0 : Math.trunc(nums[2]);
  if (basis < 0 || basis > 4) return err('NUM');
  const [s, e] = [whole(Math.min(nums[0], nums[1])), whole(Math.max(nums[0], nums[1]))];
  const days = e - s;
  switch (basis) {
    case 0:
      return days360(s, e, false) / 360;
    case 4:
      return days360(s, e, true) / 360;
    case 2:
      return days / 360;
    case 3:
      return days / 365;
    default: {
      const a = daysToYmd(s);
      const b = daysToYmd(e);
      if (a.y === b.y) return days / (isLeap(a.y) ? 366 : 365);
      const within = b.y === a.y + 1 && (b.m < a.m || (b.m === a.m && b.d <= a.d));
      if (within) {
        // Under a year apart across New Year: 366 when the span holds a February 29, else 365.
        const hasLeapDay =
          (isLeap(a.y) && s <= ymdToSerial(a.y, 2, 29)) || (isLeap(b.y) && e >= ymdToSerial(b.y, 2, 29));
        return days / (hasLeapDay ? 366 : 365);
      }
      let total = 0;
      for (let y = a.y; y <= b.y; y++) total += isLeap(y) ? 366 : 365;
      return days / (total / (b.y - a.y + 1));
    }
  }
}

export const functions: readonly FnSpec2[] = [
  {
    name: 'TODAY',
    family: 'datetime',
    params: [],
    volatile: true,
    run: (_args, env) => env.today(),
    meta: { signature: 'TODAY()', example: '=TODAY()-1 gives yesterday' },
  },
  {
    name: 'NOW',
    family: 'datetime',
    params: [],
    volatile: true,
    run: (_args, env) => {
      const clock = new Date();
      const seconds = clock.getHours() * 3600 + clock.getMinutes() * 60 + clock.getSeconds();
      return env.today() + seconds / DAY_SECONDS;
    },
    meta: { signature: 'NOW()', example: '=NOW()-TODAY() gives the time of day as a fraction' },
  },
  {
    name: 'DATE',
    family: 'datetime',
    params: [num('year'), num('month'), num('day')],
    run: (args) => {
      const nums = toNumbers(args);
      if (!Array.isArray(nums)) return nums;
      const [year, m, d] = nums.map(Math.trunc);
      // Years 0 to 99 mean 1900 to 1999. Other years count as written, so 1899-12-30 is serial 0 and earlier
      // dates are negative serials, as in Sheets (DIFFERENCES.md lists Excel's rule).
      const y = year >= 0 && year < 100 ? year + 1900 : year;
      if (y < 0 || y > 9999) return err('NUM');
      const serial = ymdToSerial(y, m, d);
      return Number.isFinite(serial) && serial <= MAX_SERIAL ? finish(serial) : err('NUM');
    },
    meta: { signature: 'DATE(year, month, day)', example: '=DATE(2024, 1, 1) gives 45292' },
  },
  datePart('YEAR', (p) => p.y, '=YEAR(45292) gives 2024'),
  datePart('MONTH', (p) => p.m, '=MONTH(45292) gives 1'),
  datePart('DAY', (p) => p.d, '=DAY(45292) gives 1'),
  timePart('HOUR', (s) => Math.floor(s / 3600), '=HOUR(0.75) gives 18'),
  timePart('MINUTE', (s) => Math.floor((s % 3600) / 60), '=MINUTE(0.5104166667) gives 15'),
  timePart('SECOND', (s) => s % 60, '=SECOND(0.0007060185) gives 1'),
  {
    name: 'TIME',
    family: 'datetime',
    params: [num('hour'), num('minute'), num('second')],
    run: (args) => {
      const nums = toNumbers(args);
      if (!Array.isArray(nums)) return nums;
      const [h, m, s] = nums.map(Math.trunc);
      if ([h, m, s].some((n) => n < 0 || n > 32767)) return err('NUM');
      return ((h * 3600 + m * 60 + s) % DAY_SECONDS) / DAY_SECONDS;
    },
    meta: { signature: 'TIME(hour, minute, second)', example: '=TIME(12, 0, 0) gives 0.5' },
  },
  {
    name: 'TIMEVALUE',
    family: 'datetime',
    params: [{ name: 'text', kind: 'text' }],
    run: ([v]) => {
      const text = toText(v);
      if (typeof text !== 'string') return text;
      // Only a time ("6:00 PM") or a date with or without a time counts. A bare number, a percent, or a grouped number
      // like "1,000" is not a time. The result is rounded to a whole second and wraps at midnight.
      const t = text.trim();
      const n = parseCanonicalNumber(t) !== null ? null : t.includes(':') ? textToNumber(t) : parseDate(t, 'mdy');
      return n === null || !Number.isFinite(n) ? err('VALUE') : secondsOfDay(n) / DAY_SECONDS;
    },
    meta: { signature: 'TIMEVALUE(text)', example: '=TIMEVALUE("6:00 PM") gives 0.75' },
  },
  {
    name: 'DATEVALUE',
    family: 'datetime',
    params: [{ name: 'text', kind: 'text' }],
    run: ([v]) => {
      const text = toText(v);
      if (typeof text !== 'string') return text;
      const n = parseDate(text, 'mdy');
      return n === null ? err('VALUE') : Math.floor(n);
    },
    meta: { signature: 'DATEVALUE(text)', example: '=DATEVALUE("2024-01-01") gives 45292' },
  },
  {
    name: 'DAYS',
    family: 'datetime',
    params: [num('end'), num('start')],
    run: (args) => {
      const nums = toNumbers(args);
      return Array.isArray(nums) ? Math.floor(nums[0]) - Math.floor(nums[1]) : nums;
    },
    meta: { signature: 'DAYS(end, start)', example: '=DAYS(45351, 45322) gives 29' },
  },
  {
    name: 'DAYS360',
    family: 'datetime',
    params: [num('start'), num('end'), { name: 'european', kind: 'bool', optional: true, default: false }],
    run: (args) => {
      const nums = toNumbers([args[0], args[1]]);
      if (!Array.isArray(nums)) return nums;
      const european = europeanFlag(args[2]);
      if (typeof european !== 'boolean') return european;
      return days360(whole(nums[0]), whole(nums[1]), european);
    },
    meta: {
      signature: 'DAYS360(start, end, [european])',
      example: '=DAYS360(DATE(2024,1,30), DATE(2024,3,1)) gives 31',
    },
  },
  {
    name: 'EDATE',
    family: 'datetime',
    params: [num('start'), num('months')],
    run: (args) => {
      const nums = toNumbers(args);
      return Array.isArray(nums) ? inRange(addMonths(whole(nums[0]), Math.trunc(nums[1]))) : nums;
    },
    meta: { signature: 'EDATE(start, months)', example: '=EDATE(DATE(2024,1,31), 1) gives the date 2024-02-29' },
  },
  {
    name: 'EOMONTH',
    family: 'datetime',
    params: [num('start'), num('months')],
    run: (args) => {
      const nums = toNumbers(args);
      return Array.isArray(nums) ? inRange(endOfMonth(whole(nums[0]), Math.trunc(nums[1]))) : nums;
    },
    meta: { signature: 'EOMONTH(start, months)', example: '=EOMONTH(DATE(2024,1,15), 0) gives the date 2024-01-31' },
  },
  {
    name: 'WEEKDAY',
    family: 'datetime',
    params: [num('date'), num('type', true, 1)],
    run: (args) => {
      const nums = toNumbers(args);
      if (!Array.isArray(nums)) return nums;
      const type = WEEKDAY_TYPES[Math.trunc(nums[1] ?? 1)];
      if (type === undefined || !inDayRange(nums[0])) return err('NUM');
      return ((weekdayOf(nums[0]) - type.first + 7) % 7) + type.base;
    },
    meta: { signature: 'WEEKDAY(date, [type])', example: '=WEEKDAY(DATE(2024,1,1)) gives 2, a Monday' },
  },
  {
    name: 'WEEKNUM',
    family: 'datetime',
    params: [num('date'), num('type', true, 1)],
    run: (args) => {
      const nums = toNumbers(args);
      if (!Array.isArray(nums)) return nums;
      const type = Math.trunc(nums[1] ?? 1);
      const date = whole(nums[0]);
      if (type === 21) return isoWeek(date);
      const first = WEEKNUM_TYPES[type];
      if (first === undefined) return err('NUM');
      const jan1 = ymdToSerial(daysToYmd(date).y, 1, 1);
      const offset = (weekdayOf(jan1) - first + 7) % 7;
      return Math.floor((dayOfYear(date) - 1 + offset) / 7) + 1;
    },
    meta: { signature: 'WEEKNUM(date, [type])', example: '=WEEKNUM(DATE(2024,3,9)) gives 10' },
  },
  {
    name: 'ISOWEEKNUM',
    family: 'datetime',
    params: [num('date')],
    run: ([v]) => {
      const n = toNumber(v);
      return typeof n === 'number' ? isoWeek(whole(n)) : n;
    },
    meta: { signature: 'ISOWEEKNUM(date)', example: '=ISOWEEKNUM(DATE(2024,1,1)) gives 1' },
  },
  {
    name: 'NETWORKDAYS',
    family: 'datetime',
    params: [num('start'), num('end'), { name: 'holidays', kind: 'range', optional: true }],
    run: (args) => networkdays(args, false),
    meta: {
      signature: 'NETWORKDAYS(start, end, [holidays])',
      example: '=NETWORKDAYS(DATE(2024,1,1), DATE(2024,1,31)) gives 23',
    },
  },
  {
    name: 'NETWORKDAYS.INTL',
    family: 'datetime',
    params: [
      num('start'),
      num('end'),
      { name: 'weekend', kind: 'value', optional: true, default: 1 },
      { name: 'holidays', kind: 'range', optional: true },
    ],
    run: (args) => networkdays(args, true),
    meta: {
      signature: 'NETWORKDAYS.INTL(start, end, [weekend], [holidays])',
      example: '=NETWORKDAYS.INTL(DATE(2024,1,1), DATE(2024,1,7), "0000011") gives 5',
    },
  },
  {
    name: 'WORKDAY',
    family: 'datetime',
    params: [num('start'), num('days'), { name: 'holidays', kind: 'range', optional: true }],
    run: (args) => workday(args, false),
    meta: {
      signature: 'WORKDAY(start, days, [holidays])',
      example: '=WORKDAY(DATE(2024,1,5), 1) gives the date 2024-01-08',
    },
  },
  {
    name: 'WORKDAY.INTL',
    family: 'datetime',
    params: [
      num('start'),
      num('days'),
      { name: 'weekend', kind: 'value', optional: true, default: 1 },
      { name: 'holidays', kind: 'range', optional: true },
    ],
    run: (args) => workday(args, true),
    meta: {
      signature: 'WORKDAY.INTL(start, days, [weekend], [holidays])',
      example: '=WORKDAY.INTL(DATE(2024,1,4), 1, 7) gives the date 2024-01-06',
    },
  },
  {
    name: 'DATEDIF',
    family: 'datetime',
    params: [num('start'), num('end'), { name: 'unit', kind: 'text' }],
    run: (args) => datedif(args),
    meta: { signature: 'DATEDIF(start, end, unit)', example: '=DATEDIF(DATE(2020,1,1), DATE(2024,6,1), "Y") gives 4' },
  },
  {
    name: 'YEARFRAC',
    family: 'datetime',
    params: [num('start'), num('end'), num('basis', true, 0)],
    run: (args) => yearfrac(args),
    meta: {
      signature: 'YEARFRAC(start, end, [basis])',
      example: '=YEARFRAC(DATE(2024,1,1), DATE(2024,7,1)) gives 0.5',
    },
  },
  {
    name: 'EPOCHTODATE',
    family: 'datetime',
    params: [num('timestamp'), num('unit', true, 1)],
    run: (args) => {
      const nums = toNumbers(args);
      if (!Array.isArray(nums)) return nums;
      const per = [0, 1, 1000, 1_000_000][Math.trunc(nums[1] ?? 1)];
      if (per === undefined || per === 0) return err('NUM');
      return finish(dateToSerial(new Date((nums[0] / per) * 1000)));
    },
    meta: { signature: 'EPOCHTODATE(timestamp, [unit])', example: '=EPOCHTODATE(0) gives 25569, the date 1970-01-01' },
  },
];
