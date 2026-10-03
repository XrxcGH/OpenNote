// Turns the events and to-dos of an .ics file into upcoming items in the viewer's time zone, with the daily and
// weekly repeats expanded for a window of dates.

import { addDays, compareDates, dateKey, type CivilDate } from './date';
import type { IcsComponent, IcsCalendar } from './ics';
import { instantOf, toViewerDue, type IcsTime } from './icsTime';
import { occurrenceDates, type DateRange } from './recurrence';
import type { UpcomingItem } from './group';

/** The most occurrences of one repeating item that one call returns. */
export const MAX_OCCURRENCES = 1000;

function within(date: CivilDate, range: DateRange): boolean {
  return compareDates(date, range.from) >= 0 && compareDates(date, range.to) <= 0;
}

function makeItem(component: IcsComponent, id: string, when: IcsTime | null, zone: string): UpcomingItem {
  return {
    id,
    title: component.title,
    due: when ? toViewerDue(when, zone) : null,
    done: component.completed,
    kind: component.kind === 'event' ? 'event' : 'task',
  };
}

/** True if two values are the same moment, or for all-day values the same day. */
function sameMoment(a: IcsTime, b: IcsTime, zone: string): boolean {
  const first = instantOf(a, zone);
  const second = instantOf(b, zone);
  if (first === null || second === null) return first === second && compareDates(a.date, b.date) === 0;
  return first === second;
}

function expand(component: IcsComponent, when: IcsTime, range: DateRange, zone: string): UpcomingItem[] {
  const rule = component.rule;
  if (!rule) return [];
  // Occurrences are made in the event's own zone. A day of margin covers the shift to the viewer's zone.
  const wide = { from: addDays(range.from, -1), to: addDays(range.to, 1) };
  const until = rule.until ? instantOf(rule.until, zone) : null;
  const items: UpcomingItem[] = [];
  for (const date of occurrenceDates(when.date, rule, wide)) {
    const occurrence: IcsTime = { ...when, date };
    const moment = instantOf(occurrence, zone);
    if (until !== null && moment !== null && moment > until) continue;
    if (component.exceptions.some((x) => sameMoment(x, occurrence, zone))) continue;
    const item = makeItem(component, `${component.uid}#${dateKey(date)}`, occurrence, zone);
    if (item.due && within(item.due.date, range)) items.push(item);
    if (items.length >= MAX_OCCURRENCES) break;
  }
  return items;
}

/** A single item. A to-do that isn't done is kept even if it is older than the window, so it shows as overdue. */
function single(component: IcsComponent, when: IcsTime | null, range: DateRange, zone: string): UpcomingItem[] {
  const id = component.replaces ? `${component.uid}#${dateKey(component.replaces.date)}` : component.uid;
  const item = makeItem(component, id, when, zone);
  if (item.due === null) return component.kind === 'todo' ? [item] : [];
  const late = component.kind === 'todo' && !component.completed && compareDates(item.due.date, range.from) < 0;
  return late || within(item.due.date, range) ? [item] : [];
}

/**
 * The items for a window of dates, in the viewer's time zone. Events in the window and to-dos that aren't done are
 * included, and canceled events are left out. A to-do with no date is included with a null due. Repeating items
 * get an id of the UID, then "#", then the date of the occurrence in its own zone, so each has its own id.
 */
export function icsToItems(calendar: IcsCalendar, range: DateRange, viewerZone: string): UpcomingItem[] {
  const replaced = new Map<string, IcsTime[]>();
  for (const c of calendar.components) {
    if (c.replaces) replaced.set(c.uid, [...(replaced.get(c.uid) ?? []), c.replaces]);
  }
  return calendar.components.flatMap((component) => {
    if (component.canceled) return [];
    const series = { ...component, exceptions: [...component.exceptions, ...(replaced.get(component.uid) ?? [])] };
    if (component.rule && component.when && !component.replaces)
      return expand(series, component.when, range, viewerZone);
    return single(component, component.when, range, viewerZone);
  });
}
