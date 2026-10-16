// Upcoming's plain-data helpers for exams, the class timetable, repeating to-dos, and calendar-file updates
// (Productivity and study tools). Everything is data in and data out, relative to an injected "now" and zone.
import {
  addDays,
  addMonths,
  compareDates,
  dateKey,
  dayOfWeek,
  daysBetween,
  daysInMonth,
  minutesOf,
  parseDateKey,
  toDays,
} from './date';
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
  /** The notebook or section the exam is for. The name is kept so it still reads right if the notebook is gone. */
  target?: ExamTarget;
  /** The calendar file it came from, so an update can replace it. */
  source?: string;
}

/** What an exam is attached to: a notebook or one of its sections. */
export interface ExamTarget {
  kind: 'notebook' | 'section';
  id: string;
  label: string;
  /** The notebook the target is in, which is the target itself for a notebook. */
  notebookId: string;
}

export const isExamTarget = (value: unknown): value is ExamTarget => {
  const target = value as ExamTarget;
  return (
    Boolean(target) &&
    (target.kind === 'notebook' || target.kind === 'section') &&
    typeof target.id === 'string' &&
    typeof target.label === 'string' &&
    typeof target.notebookId === 'string'
  );
};

/** The exams that belong with a place: its own, those of its notebook, and those attached to nothing. */
export function examsAt(
  exams: readonly Exam[],
  place: { notebookId: string | null; sectionId: string | null },
): Exam[] {
  return exams.filter((exam) => {
    const target = exam.target;
    if (!target) return true;
    if (target.kind === 'notebook') return target.id === place.notebookId;
    return target.id === place.sectionId;
  });
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
  /** The section the class's notes go in. The name is kept so it still reads right if the section is gone. */
  section?: ClassSection;
  source?: string;
}

/** The section a class is linked to. */
export interface ClassSection {
  id: string;
  label: string;
  /** The notebook the section is in. */
  notebookId: string;
}

export const isClassSection = (value: unknown): value is ClassSection => {
  const section = value as ClassSection;
  return (
    Boolean(section) &&
    typeof section.id === 'string' &&
    typeof section.label === 'string' &&
    typeof section.notebookId === 'string'
  );
};

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
    (repeat.unit === 'day' || repeat.unit === 'week' || repeat.unit === 'weekday' || repeat.unit === 'month') &&
    (repeat.mode === 'schedule' || repeat.mode === 'afterFinish') &&
    (repeat.days === undefined ||
      (Array.isArray(repeat.days) && repeat.days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6))) &&
    (repeat.dayOfMonth === undefined ||
      repeat.dayOfMonth === -1 ||
      (Number.isInteger(repeat.dayOfMonth) && repeat.dayOfMonth >= 1 && repeat.dayOfMonth <= 31))
  );
};

const isWeekday = (date: CivilDate): boolean => dayOfWeek(date) >= 1 && dayOfWeek(date) <= 5;

/** The first date after `date` that falls on one of the days. */
function dayAfter(date: CivilDate, onDay: (date: CivilDate) => boolean): CivilDate {
  let next = addDays(date, 1);
  for (let guard = 0; guard < 8 && !onDay(next); guard += 1) next = addDays(next, 1);
  return next;
}

/** The date in the month `months` from this one on the repeat's day of the month, or the start's day if it names none. */
function inMonth(repeat: Repeat, from: CivilDate, months: number, anchorDay: number): CivilDate {
  const target = addMonths({ ...from, day: 1 }, months);
  const last = daysInMonth(target.year, target.month);
  const wanted = repeat.dayOfMonth ?? anchorDay;
  return { ...target, day: wanted === -1 ? last : Math.min(wanted, last) };
}

/** The date one step on from `date`, in the repeat's own rhythm. */
function stepFrom(repeat: Repeat, date: CivilDate, anchorDay: number): CivilDate {
  switch (repeat.unit) {
    case 'weekday':
      return dayAfter(date, isWeekday);
    case 'month':
      return inMonth(repeat, date, repeat.every, anchorDay);
    case 'week':
      return repeat.days && repeat.days.length > 0
        ? dayAfter(date, (day) => repeat.days!.includes(dayOfWeek(day)))
        : addDays(date, repeat.every * 7);
    default:
      return addDays(date, repeat.every);
  }
}

/**
 * The next due date after finishing or skipping. A scheduled repeat keeps its rhythm but never lands on a day that
 * has passed, so a week of missed repeats leaves one task, not seven. "N days after I finish" counts from today.
 */
export function nextDue(repeat: Repeat, due: Due | null, today: CivilDate): Due {
  const time = due?.time ?? null;
  const base = due?.date ?? today;
  const anchorDay = base.day;
  if (repeat.mode === 'afterFinish') {
    // Counting from today, a day-based repeat is today plus the step; the others take their first day after today.
    const date =
      repeat.unit === 'weekday' || (repeat.unit === 'week' && repeat.days?.length)
        ? stepFrom(repeat, today, today.day)
        : repeat.unit === 'month'
          ? inMonth(repeat, today, repeat.every, today.day)
          : addDays(today, repeat.every * (repeat.unit === 'week' ? 7 : 1));
    return { date, time };
  }
  let next = stepFrom(repeat, base, anchorDay);
  for (let guard = 0; guard < 5000 && compareDates(next, today) <= 0; guard += 1) {
    next = stepFrom(repeat, next, anchorDay);
  }
  return { date: next, time };
}

/** The first date a repeat falls on when the person gave none: today if it fits, or the next day that does. */
export function firstDue(repeat: Repeat, today: CivilDate): Due {
  const fits =
    repeat.unit === 'weekday'
      ? isWeekday(today)
      : repeat.unit === 'week' && repeat.days?.length
        ? repeat.days.includes(dayOfWeek(today))
        : repeat.unit === 'month' && repeat.dayOfMonth !== undefined
          ? compareDates(inMonth(repeat, today, 0, today.day), today) === 0
          : true;
  if (fits) return { date: today, time: null };
  if (repeat.unit === 'month') {
    const thisMonth = inMonth(repeat, today, 0, today.day);
    return { date: compareDates(thisMonth, today) > 0 ? thisMonth : inMonth(repeat, today, 1, today.day), time: null };
  }
  return { date: stepFrom(repeat, today, today.day), time: null };
}

/** The item that follows a finished or skipped repeating one, or null if it does not repeat. */
export function followingItem(item: UpcomingItem, today: CivilDate, newId: string): UpcomingItem | null {
  if (!item.repeat) return null;
  const repeat =
    item.repeat.unit === 'month' && item.repeat.dayOfMonth === undefined && item.due
      ? { ...item.repeat, dayOfMonth: item.due.date.day }
      : item.repeat;
  return { ...item, id: newId, done: false, repeat, due: nextDue(repeat, item.due, today) };
}
