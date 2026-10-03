// Repeat rules (RRULE) for daily and weekly events. Monthly and yearly rules aren't expanded, so they return a note
// and the event shows once. Dates come out in the event's own zone, so a 10:00 class stays at 10:00 across daylight
// saving time, and the caller converts each one to the viewer's zone.

import { addDays, compareDates, dayOfWeek, daysBetween, startOfWeek, type CivilDate, type Weekday } from './date';
import { parseIcsTime, type IcsTime } from './icsTime';

export interface Recurrence {
  freq: 'daily' | 'weekly';
  /** Repeat every this many days or weeks. */
  interval: number;
  /** The total number of occurrences, or null for no limit. */
  count: number | null;
  until: IcsTime | null;
  /** The weekdays, for a weekly rule. Empty means the weekday of the first occurrence. */
  byDay: Weekday[];
  /** The day a week starts on. It matters for a weekly rule with an interval above 1. */
  weekStart: Weekday;
}

export interface ParsedRule {
  rule: Recurrence | null;
  /** The frequency of a rule that isn't supported, such as "monthly". Null if the rule is supported or absent. */
  note: string | null;
}

export interface DateRange {
  from: CivilDate;
  to: CivilDate;
}

const DAY_CODES = new Map<string, Weekday>([
  ['SU', 0],
  ['MO', 1],
  ['TU', 2],
  ['WE', 3],
  ['TH', 4],
  ['FR', 5],
  ['SA', 6],
]);

const MAX_STEPS = 20_000;

function positive(value: string | undefined): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

function weekdays(list: string | undefined): Weekday[] {
  const codes = (list ?? '').split(',').map((part) => DAY_CODES.get(part.replace(/^[+-]?\d*/, '')));
  return [...new Set(codes.filter((d): d is Weekday => d !== undefined))];
}

/** Reads an RRULE value such as "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10". */
export function parseRule(value: string): ParsedRule {
  const parts = new Map(
    value.split(';').map((part) => {
      const [key, ...rest] = part.split('=');
      return [key.trim().toUpperCase(), rest.join('=').trim().toUpperCase()] as const;
    }),
  );
  const freq = parts.get('FREQ');
  if (freq !== 'DAILY' && freq !== 'WEEKLY') return { rule: null, note: freq ? freq.toLowerCase() : 'unknown' };
  const until = parts.get('UNTIL');
  return {
    note: null,
    rule: {
      freq: freq === 'DAILY' ? 'daily' : 'weekly',
      interval: positive(parts.get('INTERVAL')) ?? 1,
      count: positive(parts.get('COUNT')),
      until: until ? parseIcsTime(until) : null,
      byDay: weekdays(parts.get('BYDAY')),
      weekStart: weekdays(parts.get('WKST'))[0] ?? 1,
    },
  };
}

function* daily(start: CivilDate, rule: Recurrence, skipTo: CivilDate): Generator<CivilDate> {
  const first = Math.max(0, Math.floor(daysBetween(start, skipTo) / rule.interval));
  for (let step = first; step < first + MAX_STEPS; step += 1) {
    const date = addDays(start, step * rule.interval);
    if (rule.byDay.length === 0 || rule.byDay.includes(dayOfWeek(date))) yield date;
  }
}

function* weekly(start: CivilDate, rule: Recurrence, skipTo: CivilDate): Generator<CivilDate> {
  const offsets = (rule.byDay.length > 0 ? rule.byDay : [dayOfWeek(start)])
    .map((day) => (day - rule.weekStart + 7) % 7)
    .sort((a, b) => a - b);
  const firstWeek = startOfWeek(start, rule.weekStart);
  const skipped = Math.floor(Math.floor(daysBetween(firstWeek, skipTo) / 7) / rule.interval) * rule.interval;
  for (let week = Math.max(0, skipped), steps = 0; steps < MAX_STEPS; week += rule.interval, steps += 1) {
    for (const offset of offsets) {
      const date = addDays(firstWeek, week * 7 + offset);
      if (compareDates(date, start) >= 0) yield date;
    }
  }
}

/**
 * The dates a rule produces from its first date, in order, from range.from to range.to. A COUNT applies to the
 * whole series, so the series is counted from its start. Without a COUNT it jumps ahead to the range. The end date
 * (UNTIL) only bounds the search, with a day to spare. When it has a time, the caller makes the exact cut, because
 * that depends on the time zone.
 */
export function* occurrenceDates(start: CivilDate, rule: Recurrence, range: DateRange): Generator<CivilDate> {
  const skipTo = rule.count === null ? range.from : start;
  const dates = rule.freq === 'daily' ? daily(start, rule, skipTo) : weekly(start, rule, skipTo);
  let produced = 0;
  for (const date of dates) {
    if (compareDates(date, range.to) > 0) return;
    if (rule.until && compareDates(date, addDays(rule.until.date, 1)) > 0) return;
    produced += 1;
    if (rule.count !== null && produced > rule.count) return;
    if (compareDates(date, range.from) >= 0) yield date;
  }
}
