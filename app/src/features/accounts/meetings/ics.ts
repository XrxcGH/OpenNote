// Meetings from a calendar file (.ics), the way in when no account is connected. The Upcoming tool's reader finds the
// events and expands the daily and weekly repeats in a window of dates; this adds what a meeting note needs and that
// reader leaves out: the description, who is invited, and the link.

import { dateIn, icsToItems, parseIcs, toInstant } from '../../tools';
import type { IcsComponent, IcsTime } from '../../tools';
import { agendaText } from './text';
import type { MeetingEvent } from './types';
import { windowAround } from './types';

interface Details {
  description: string;
  attendees: string[];
  link: string;
}

const unfold = (text: string): string[] =>
  text
    .replace(/\r\n|\r/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
    .filter((line) => line.trim() !== '');

const unescapeText = (value: string): string =>
  value.replace(/\\([nN,;\\])/g, (_, char: string) => (char === 'n' || char === 'N' ? '\n' : char));

/** The name of a person line: the CN parameter, else the address after `mailto:`. */
function personOf(head: string, value: string): string {
  const common = /;CN=("([^"]*)"|[^;:]*)/i.exec(head);
  const name = common?.[2] ?? common?.[1] ?? '';
  return name.trim() || value.replace(/^mailto:/i, '').trim();
}

/** The description, the people, and the link of each event, by UID. */
function detailsByUid(text: string): Map<string, Details> {
  const found = new Map<string, Details>();
  let open: (Details & { uid: string }) | null = null;
  for (const line of unfold(text)) {
    const at = line.indexOf(':');
    if (at < 0) continue;
    const head = line.slice(0, at);
    const value = line.slice(at + 1);
    const name = head.split(';')[0]?.toUpperCase() ?? '';
    if (name === 'BEGIN' && value.trim().toUpperCase() === 'VEVENT')
      open = { uid: '', description: '', attendees: [], link: '' };
    else if (name === 'END' && value.trim().toUpperCase() === 'VEVENT' && open) {
      if (open.uid) found.set(open.uid, open);
      open = null;
    } else if (open && name === 'UID') open.uid = value.trim();
    else if (open && name === 'DESCRIPTION') open.description = unescapeText(value);
    else if (open && name === 'URL') open.link = value.trim();
    else if (open && (name === 'ORGANIZER' || name === 'ATTENDEE')) {
      const person = personOf(head, value);
      if (person) open.attendees[name === 'ORGANIZER' ? 'unshift' : 'push'](person);
    }
  }
  return found;
}

/** The moment of an iCalendar time in the viewer's zone, as milliseconds. */
function instantOf(time: IcsTime, viewerZone: string): number {
  return toInstant(time.date, time.time ?? { hour: 0, minute: 0 }, time.zone ?? viewerZone);
}

function idOf(itemId: string): string {
  return itemId.split('#')[0] ?? itemId;
}

function lengthOf(component: IcsComponent, viewerZone: string): number | null {
  if (!component.when || !component.end) return null;
  const length = instantOf(component.end, viewerZone) - instantOf(component.when, viewerZone);
  return length >= 0 ? length : null;
}

/** The meetings in a calendar file for the last day and the next week. A file with none gives an empty list. */
export function eventsFromIcs(text: string, now: Date, zone: string): MeetingEvent[] {
  const calendar = parseIcs(text);
  const events = calendar.components.filter((component) => component.kind === 'event');
  const window = windowAround(now);
  const range = { from: dateIn(window.from.getTime(), zone), to: dateIn(window.to.getTime(), zone) };
  const details = detailsByUid(text);
  const meetings: MeetingEvent[] = [];
  for (const item of icsToItems({ components: events, skipped: 0 }, range, zone)) {
    const uid = idOf(item.id);
    const component = events.find((one) => one.uid === uid && !one.replaces) ?? events.find((one) => one.uid === uid);
    if (!component || !item.due) continue;
    const start = toInstant(item.due.date, item.due.time ?? { hour: 0, minute: 0 }, zone);
    if (start < window.from.getTime() || start > window.to.getTime()) continue;
    const length = lengthOf(component, zone);
    const extra = details.get(uid);
    meetings.push({
      source: 'ics',
      id: item.id,
      title: component.title,
      start: new Date(start).toISOString(),
      end: length === null ? null : new Date(start + length).toISOString(),
      allDay: component.when?.time === null,
      location: component.location ?? '',
      attendees: [...new Set(extra?.attendees ?? [])],
      agenda: agendaText(extra?.description ?? '', false),
      joinLink: extra?.link ?? '',
    });
  }
  return meetings.sort((a, b) => a.start.localeCompare(b.start));
}
