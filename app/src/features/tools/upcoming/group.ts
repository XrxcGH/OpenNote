// Sorts tasks and events into Overdue, Today, This week, and Later, for the "upcoming" list.
//
// "This week" is the days after today up to the end of the calendar week, which ends the day before the week-start
// day. A date-only item is overdue once its day is over. An item with a time is overdue once that time passes.

import { addDays, compareDates, compareDues, startOfWeek, type Due, type Weekday } from './date';
import { dateIn, dueInstant } from './zone';

/** How a to-do repeats. 'schedule' keeps its rhythm; 'afterFinish' counts from the day it was finished. */
export interface Repeat {
  every: number;
  unit: 'day' | 'week';
  mode: 'schedule' | 'afterFinish';
}

export interface UpcomingItem {
  id: string;
  title: string;
  /** When it is due, or null if it has no date. */
  due: Due | null;
  done: boolean;
  /** A task is something to finish, and an event is something that happens at a time. The default is a task. */
  kind?: 'task' | 'event';
  /** Set on a to-do that repeats. Finishing or skipping it makes the next one. */
  repeat?: Repeat;
  /** The calendar file the item came from, so an update from that file can replace it. */
  source?: string;
  /** Set on an item read from a line of a page. The page owns it, so Upcoming shows it and does not change it. */
  page?: { id: string; title: string; block: string; line: number };
}

export type UpcomingGroupId = 'overdue' | 'today' | 'thisWeek' | 'later';

export interface UpcomingGroups {
  overdue: UpcomingItem[];
  today: UpcomingItem[];
  thisWeek: UpcomingItem[];
  later: UpcomingItem[];
  /** Items with no due date. */
  undated: UpcomingItem[];
}

export interface GroupContext {
  now: number;
  timeZone: string;
  /** 0 for Sunday, as in en-US. */
  weekStart?: Weekday;
}

export interface GroupOptions {
  /** Keep items that are done. They are left out by default. */
  includeDone?: boolean;
}

/** Which group a due date belongs in at this moment. */
export function classifyDue(due: Due, context: GroupContext): UpcomingGroupId {
  const today = dateIn(context.now, context.timeZone);
  if (due.time && dueInstant(due, context.timeZone) < context.now) return 'overdue';
  const byDate = compareDates(due.date, today);
  if (byDate < 0) return 'overdue';
  if (byDate === 0) return 'today';
  const weekEnd = addDays(startOfWeek(today, context.weekStart ?? 0), 6);
  return compareDates(due.date, weekEnd) <= 0 ? 'thisWeek' : 'later';
}

/** Puts the items in groups. Each group is in date and time order, with all-day items before timed ones. */
export function groupUpcoming(items: readonly UpcomingItem[], context: GroupContext, options: GroupOptions = {}) {
  const groups: UpcomingGroups = { overdue: [], today: [], thisWeek: [], later: [], undated: [] };
  const dated: { item: UpcomingItem; due: Due }[] = [];
  for (const item of items) {
    if (item.done && !options.includeDone) continue;
    if (item.due === null) groups.undated.push(item);
    else dated.push({ item, due: item.due });
  }
  dated.sort((a, b) => compareDues(a.due, b.due) || a.item.title.localeCompare(b.item.title));
  for (const { item, due } of dated) groups[classifyDue(due, context)].push(item);
  groups.undated.sort((a, b) => a.title.localeCompare(b.title));
  return groups;
}
