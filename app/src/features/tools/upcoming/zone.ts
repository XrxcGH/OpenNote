// Time zones, through the built-in Intl API, so no zone data ships with the app. A zone is an IANA name such as
// "America/New_York". Dates and times in a zone are "wall clock" values, which is what people type and read.

import { addDays, type CivilDate, type ClockTime, type Due } from './date';

const DAY_MS = 86_400_000;

/** A wall-clock date and time, with seconds. */
export interface WallTime {
  date: CivilDate;
  time: ClockTime & { second: number };
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, found);
  }
  return found;
}

/** True if the name is a time zone this runtime knows, such as "Europe/Paris" or "UTC". */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock date and time in a zone at an instant, given in milliseconds since 1970 UTC. */
export function wallTime(instant: number, timeZone: string): WallTime {
  const fields = new Map<string, number>();
  for (const part of formatter(timeZone).formatToParts(instant)) fields.set(part.type, Number(part.value));
  return {
    date: { year: fields.get('year') ?? 1970, month: fields.get('month') ?? 1, day: fields.get('day') ?? 1 },
    time: {
      hour: (fields.get('hour') ?? 0) % 24,
      minute: fields.get('minute') ?? 0,
      second: fields.get('second') ?? 0,
    },
  };
}

/** How far the zone's wall clock is ahead of UTC at an instant, in milliseconds. */
function offsetAt(instant: number, timeZone: string): number {
  const { date, time } = wallTime(instant, timeZone);
  const wall = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute, time.second);
  return wall - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant when a zone's wall clock shows this date and time. When the clock shows it twice, as it does when
 * daylight saving time ends, this is the first time. When it never shows it, as when daylight saving time starts,
 * this is the moment the clock jumps to, so 2:30 becomes 3:30.
 */
export function toInstant(date: CivilDate, time: ClockTime & { second?: number }, timeZone: string): number {
  const wall = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute, time.second ?? 0);
  const before = offsetAt(wall - DAY_MS, timeZone);
  const after = offsetAt(wall + DAY_MS, timeZone);
  const valid = [before, after].map((offset) => wall - offset).filter((t) => offsetAt(t, timeZone) === wall - t);
  return valid.length > 0 ? Math.min(...valid) : wall - before;
}

/** Today's date in a zone. */
export const dateIn = (instant: number, timeZone: string): CivilDate => wallTime(instant, timeZone).date;

const START_OF_DAY: ClockTime = { hour: 0, minute: 0 };

/**
 * The instant a due date falls. A due with a time is that time. A due with only a date is the last millisecond
 * of the day, so it is not late until the day is over.
 */
export function dueInstant(due: Due, timeZone: string): number {
  if (due.time) return toInstant(due.date, due.time, timeZone);
  return toInstant(addDays(due.date, 1), START_OF_DAY, timeZone) - 1;
}

/** Converts an instant to a due in a zone, with the time. */
export function dueAt(instant: number, timeZone: string): Due {
  const { date, time } = wallTime(instant, timeZone);
  return { date, time: { hour: time.hour, minute: time.minute } };
}
