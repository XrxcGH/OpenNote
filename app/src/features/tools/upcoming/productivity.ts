// Upcoming's plain-data helpers for exams, the class timetable, repeating to-dos, and calendar-file updates
// (Productivity and study tools). Everything is data in and data out, relative to an injected "now" and zone.
import { addDays, compareDates, dateKey, dayOfWeek, daysBetween, minutesOf, parseDateKey, toDays } from './date';
import type { CivilDate, Due, Weekday } from './date';
import type { Repeat, UpcomingItem } from './group';
import type { IcsCalendar, IcsComponent } from './ics';
import { icsToItems } from './icsItems';
import { toViewerDue } from './icsTime';
import type { DateRange } from './recurrence';
import { dueAt } from './zone';

// ---- Exams -----------------------------------------------------------------------------------------------------

export interface Exam {
  id: string;
  name: string;
  /** YYYY-MM-DD. */
  date: string;
  /** HH:MM, or empty for no time. */
  time: string;
  /** A deck the exam is for. The deck shows the same countdown. */
  deck?: string;
  /** The calendar file it came from, so an update can replace it. */
  source?: string;
}

/** Whole days from today to the exam: 0 on the day, negative after it. NaN if the date is not valid. */
export function daysLeft(exam: Pick<Exam, 'date'>, today: CivilDate): number {
  const date = parseDateKey(exam.date);
  return date ? daysBetween(today, date) : Number.NaN;
}

/** The exams still ahead (or today), soonest first. */
export function examsAhead(exams: readonly Exam[], today: CivilDate): Exam[] {
  return exams
    .filter((exam) => daysLeft(exam, today) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.name.localeCompare(b.name));
}

// ---- Class timetable -------------------------------------------------------------------------------------------

export interface ClassSlot {
  id: string;
  name: string;
  days: Weekday[];
  /** HH:MM, 24 hours. */
  start: string;
  end: string;
  room: string;
  source?: string;
}

/** Minutes after midnight for "HH:MM", or NaN. */
export function minutesOfText(text: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return Number.NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

export const clockText = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** The classes on a day, in time order. */
export function classesOn(slots: readonly ClassSlot[], date: CivilDate): ClassSlot[] {
  const day = dayOfWeek(date);
  return slots
    .filter((slot) => slot.days.includes(day))
    .sort((a, b) => minutesOfText(a.start) - minutesOfText(b.start) || a.name.localeCompare(b.name));
}

/** The next class that has not started yet, looking a week ahead, or null. */
export function nextClass(
  slots: readonly ClassSlot[],
  now: number,
  zone: string,
): { slot: ClassSlot; date: CivilDate } | null {
  const here = dueAt(now, zone);
  const minutes = here.time ? minutesOf(here.time) : 0;
  for (let ahead = 0; ahead <= 7; ahead += 1) {
    const date = addDays(here.date, ahead);
    const found = classesOn(slots, date).find((slot) => ahead > 0 || minutesOfText(slot.start) > minutes);
    if (found) return { slot: found, date };
  }
  return null;
}

function slotOf(component: IcsComponent, zone: string): ClassSlot | null {
  const { rule, when } = component;
  if (component.kind !== 'event' || !rule || rule.freq !== 'weekly' || !when?.time || component.replaces) return null;
  const start = toViewerDue(when, zone);
  const end = component.end?.time ? toViewerDue(component.end, zone) : null;
  const startMinutes = start.time ? minutesOf(start.time) : 0;
  const days = (rule.byDay.length > 0 ? rule.byDay : [dayOfWeek(when.date)]).map(
    // A zone change can move the class to another day; shift by whole days the same way as the start.
    (day) => ((day + (toDays(start.date) - toDays(when.date)) + 7 * 100) % 7) as Weekday,
  );
  return {
    id: `ics:${component.uid}`,
    name: component.title || component.location || '',
    days: [...new Set(days)].sort(),
    start: clockText(startMinutes),
    end: clockText(end?.time ? minutesOf(end.time) : startMinutes),
    room: component.location ?? '',
  };
}

// ---- Calendar files --------------------------------------------------------------------------------------------

const EXAM_WORDS = /\b(exam|midterm|final|quiz|test)\b/i;

export interface IcsPlan {
  classes: ClassSlot[];
  exams: Exam[];
  /** Assignments, other events, and to-dos. */
  items: UpcomingItem[];
  skipped: number;
}

/** Sorts a calendar file into a timetable, exam dates, and assignments or other dated items. */
export function planIcsImport(calendar: IcsCalendar, range: DateRange, zone: string, source: string): IcsPlan {
  const classes: ClassSlot[] = [];
  const exams: Exam[] = [];
  const others: IcsComponent[] = [];
  for (const component of calendar.components) {
    const slot = slotOf(component, zone);
    if (slot) classes.push({ ...slot, source });
    else if (component.kind === 'event' && !component.rule && component.when && EXAM_WORDS.test(component.title)) {
      const due = toViewerDue(component.when, zone);
      exams.push({
        id: `ics:${component.uid}`,
        name: component.title,
        date: dateKey(due.date),
        time: due.time ? clockText(minutesOf(due.time)) : '',
        source,
      });
    } else others.push(component);
  }
  const items = icsToItems({ components: others, skipped: 0 }, range, zone).map((item) => ({
    ...item,
    id: `ics:${item.id}`,
    source,
  }));
  return { classes, exams, items, skipped: calendar.skipped };
}

/**
 * Applies a new copy of a calendar file to what an earlier copy added: items from that file are replaced by the
 * new ones, and an item that was done and is still in the file stays done. Everything from other sources is kept.
 */
export function updateFromFile<T extends { id: string; source?: string }>(
  existing: readonly T[],
  incoming: readonly T[],
  source: string,
): { next: T[]; added: number; removed: number; changed: number } {
  const earlier = new Map(existing.filter((one) => one.source === source).map((one) => [one.id, one]));
  const kept = existing.filter((one) => one.source !== source);
  let changed = 0;
  const merged = incoming.map((one) => {
    const old = earlier.get(one.id);
    if (!old) return one;
    if (JSON.stringify({ ...old, done: undefined }) !== JSON.stringify({ ...one, done: undefined })) changed += 1;
    return 'done' in old ? { ...one, done: (old as { done?: boolean }).done } : one;
  });
  const ids = new Set(incoming.map((one) => one.id));
  return {
    next: [...kept, ...merged],
    added: incoming.filter((one) => !earlier.has(one.id)).length,
    removed: [...earlier.keys()].filter((id) => !ids.has(id)).length,
    changed,
  };
}

// ---- Repeating to-dos ------------------------------------------------------------------------------------------

export type { Repeat };

export const isRepeat = (value: unknown): value is Repeat => {
  const repeat = value as Repeat;
  return (
    Boolean(repeat) &&
    Number.isInteger(repeat.every) &&
    repeat.every >= 1 &&
    repeat.every <= 365 &&
    (repeat.unit === 'day' || repeat.unit === 'week') &&
    (repeat.mode === 'schedule' || repeat.mode === 'afterFinish')
  );
};

/**
 * The next due date after finishing or skipping. A scheduled repeat keeps its rhythm but never lands on a day that
 * has passed, so a week of missed repeats leaves one task, not seven. "N days after I finish" counts from today.
 */
export function nextDue(repeat: Repeat, due: Due | null, today: CivilDate): Due {
  const step = repeat.every * (repeat.unit === 'week' ? 7 : 1);
  const time = due?.time ?? null;
  if (repeat.mode === 'afterFinish') return { date: addDays(today, step), time };
  const base = due?.date ?? today;
  let next = addDays(base, step);
  if (compareDates(next, today) <= 0) {
    const passed = daysBetween(base, today);
    next = addDays(base, step * (Math.floor(passed / step) + 1));
  }
  return { date: next, time };
}

/** The item that follows a finished or skipped repeating one, or null if it does not repeat. */
export function followingItem(item: UpcomingItem, today: CivilDate, newId: string): UpcomingItem | null {
  if (!item.repeat) return null;
  return { ...item, id: newId, done: false, due: nextDue(item.repeat, item.due, today) };
}
