// A writer for local calendar files in iCalendar (.ics) format: the dated tasks and events, the exams, and the weekly
// classes, so what is in Upcoming can be kept or opened in another calendar. Times are written as floating local
// times (no time zone), so they read as the same wall-clock time wherever the file is opened. It reads nothing.
import type { CivilDate } from './date';
import type { UpcomingItem } from './group';
import type { ClassSlot, Exam } from './productivity';

const pad = (value: number, width = 2) => String(value).padStart(width, '0');
const dayText = (date: CivilDate) => `${pad(date.year, 4)}${pad(date.month)}${pad(date.day)}`;
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

/** Text as a property value: backslash, semicolon, comma, and line breaks are written the way the format asks. */
export function escapeIcsText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** A line folded at 75 characters, each continuation starting with one space. */
function fold(line: string): string[] {
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    parts.push(rest.slice(0, 75));
    rest = ` ${rest.slice(75)}`;
  }
  return [...parts, rest];
}

const parseDate = (key: string): CivilDate | null => {
  const found = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return found ? { year: Number(found[1]), month: Number(found[2]), day: Number(found[3]) } : null;
};

const clock = (text: string): string | null => {
  const found = /^(\d{1,2}):(\d{2})$/.exec(text);
  return found ? `${pad(Number(found[1]))}${found[2]}00` : null;
};

/** The weekday (0 is Sunday) of a civil date. */
const weekdayOf = (date: CivilDate): number => new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();

function addDay(date: CivilDate): CivilDate {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

export interface IcsSource {
  items: readonly UpcomingItem[];
  exams: readonly Exam[];
  classes: readonly ClassSlot[];
  /** The day a weekly class with no start date begins on. */
  today: CivilDate;
  /** When the file was made, as a UTC stamp such as 20261104T150000Z. */
  stamp: string;
}

/** The calendar file text for what Upcoming holds. Items with no date are left out; they have no place in a calendar. */
export function writeIcs(source: IcsSource): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OpenNote//Upcoming//EN', 'CALSCALE:GREGORIAN'];
  const add = (...more: string[]) => more.forEach((line) => lines.push(...fold(line)));
  const open = (kind: 'VEVENT' | 'VTODO', uid: string, title: string) =>
    add(
      `BEGIN:${kind}`,
      `UID:${escapeIcsText(uid)}@opennote`,
      `DTSTAMP:${source.stamp}`,
      `SUMMARY:${escapeIcsText(title)}`,
    );

  for (const item of source.items) {
    if (!item.due) continue;
    const day = dayText(item.due.date);
    const time = item.due.time ? `${pad(item.due.time.hour)}${pad(item.due.time.minute)}00` : null;
    const stamp = time ? `:${day}T${time}` : `;VALUE=DATE:${day}`;
    if (item.kind === 'event') {
      open('VEVENT', item.id, item.title);
      add(`DTSTART${stamp}`);
    } else {
      open('VTODO', item.id, item.title);
      add(`DUE${stamp}`, `STATUS:${item.done ? 'COMPLETED' : 'NEEDS-ACTION'}`);
    }
    add(`END:${item.kind === 'event' ? 'VEVENT' : 'VTODO'}`);
  }

  for (const exam of source.exams) {
    const date = parseDate(exam.date);
    if (!date) continue;
    const time = clock(exam.time);
    open('VEVENT', exam.id, exam.name);
    add(time ? `DTSTART:${dayText(date)}T${time}` : `DTSTART;VALUE=DATE:${dayText(date)}`, 'END:VEVENT');
  }

  for (const slot of source.classes) {
    const start = clock(slot.start);
    const end = clock(slot.end);
    if (slot.days.length === 0 || !start) continue;
    // A weekly class starts on the first day it meets, on or after its start date.
    let first = (slot.from ? parseDate(slot.from) : null) ?? source.today;
    for (let guard = 0; guard < 7 && !slot.days.includes(weekdayOf(first) as ClassSlot['days'][number]); guard += 1) {
      first = addDay(first);
    }
    open('VEVENT', slot.id, slot.name);
    add(
      `DTSTART:${dayText(first)}T${start}`,
      ...(end ? [`DTEND:${dayText(first)}T${end}`] : []),
      `RRULE:FREQ=WEEKLY;BYDAY=${[...slot.days]
        .sort()
        .map((day) => WEEKDAYS[day])
        .join(',')}`,
      ...(slot.room ? [`LOCATION:${escapeIcsText(slot.room)}`] : []),
      'END:VEVENT',
    );
  }

  add('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}
