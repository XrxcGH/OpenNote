// Dates and times as iCalendar (RFC 5545) writes them: "20261003" for a day, "20261003T170000" for a local time,
// "20261003T170000Z" for UTC, and "TZID=America/New_York:20261003T170000" for a named zone.

import { isValidDate, type CivilDate, type ClockTime, type Due } from './date';
import { dueAt, isValidTimeZone, toInstant } from './zone';

export interface IcsTime {
  date: CivilDate;
  /** Null for a date with no time, which is an all-day value. */
  time: ClockTime | null;
  /** An IANA zone name, "UTC", or null for a floating time, which means the viewer's own zone. */
  zone: string | null;
}

export type IcsParams = Readonly<Record<string, string>>;

/** The Windows zone names that Outlook writes, for the zones a student is most likely to have. */
const WINDOWS_ZONES = new Map([
  ['Eastern Standard Time', 'America/New_York'],
  ['Central Standard Time', 'America/Chicago'],
  ['Mountain Standard Time', 'America/Denver'],
  ['Pacific Standard Time', 'America/Los_Angeles'],
  ['Alaskan Standard Time', 'America/Anchorage'],
  ['Hawaiian Standard Time', 'Pacific/Honolulu'],
  ['GMT Standard Time', 'Europe/London'],
  ['W. Europe Standard Time', 'Europe/Berlin'],
  ['India Standard Time', 'Asia/Kolkata'],
  ['Tokyo Standard Time', 'Asia/Tokyo'],
  ['AUS Eastern Standard Time', 'Australia/Sydney'],
  ['UTC', 'UTC'],
]);

const VALUE = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i;

/** The zone for a TZID, or null, which treats the time as floating, if the name isn't one this runtime knows. */
function zoneFor(tzid: string | undefined): string | null {
  if (!tzid) return null;
  const name = WINDOWS_ZONES.get(tzid) ?? tzid;
  return isValidTimeZone(name) ? name : null;
}

/** Reads one date or date-time value with its parameters, or returns null if it isn't valid. */
export function parseIcsTime(value: string, params: IcsParams = {}): IcsTime | null {
  const match = VALUE.exec(value.trim());
  if (!match) return null;
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (!isValidDate(date)) return null;
  if (match[4] === undefined || params.VALUE === 'DATE') return { date, time: null, zone: null };
  const time = { hour: Number(match[4]), minute: Number(match[5]) };
  if (time.hour > 23 || time.minute > 59) return null;
  return { date, time, zone: match[7] ? 'UTC' : zoneFor(params.TZID) };
}

/** When this value falls in the viewer's zone. An all-day or floating value keeps its date and time. */
export function toViewerDue(value: IcsTime, viewerZone: string): Due {
  if (value.time === null || value.zone === null || value.zone === viewerZone) {
    return { date: value.date, time: value.time };
  }
  return dueAt(toInstant(value.date, value.time, value.zone), viewerZone);
}

/** The instant of a timed value, or null for an all-day one. A floating value uses the viewer's zone. */
export function instantOf(value: IcsTime, viewerZone: string): number | null {
  return value.time === null ? null : toInstant(value.date, value.time, value.zone ?? viewerZone);
}
