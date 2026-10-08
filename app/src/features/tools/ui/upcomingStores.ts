// What Upcoming remembers beyond its own list (Productivity and study tools): exam dates, the class timetable, the
// items read from lines on pages, and whether reminders are on. All of it stays on this device.
import { createStore } from '../../../state/store';
import type { ClassSlot, Exam } from '../upcoming';
import { dateKey } from '../upcoming';
import { findPageDues } from '../upcoming/pageDue';
import type { UpcomingItem } from '../upcoming';
import { followStored, loadStored, saveStored } from './storage';

const EXAMS = 'exams';
const TIMETABLE = 'timetable';
const PAGE_ITEMS = 'pageItems';
export const REMINDERS = 'reminders';

const list = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const readExams = (value: unknown): Exam[] =>
  list<Exam>(value).filter((exam) => typeof exam?.id === 'string' && typeof exam.date === 'string');
const readTimetable = (value: unknown): ClassSlot[] =>
  list<ClassSlot>(value).filter((slot) => typeof slot?.id === 'string' && Array.isArray(slot.days));
const readPageItems = (value: unknown): Record<string, PageEntry> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, PageEntry>) : {};

export const examsStore = createStore<readonly Exam[]>(readExams(loadStored<unknown>(EXAMS, [])), 'tools exams');
export const timetableStore = createStore<readonly ClassSlot[]>(
  readTimetable(loadStored<unknown>(TIMETABLE, [])),
  'tools timetable',
);

export function setExams(next: readonly Exam[]): void {
  examsStore.set(next);
  saveStored(EXAMS, next);
}

export function setTimetable(next: readonly ClassSlot[]): void {
  timetableStore.set(next);
  saveStored(TIMETABLE, next);
}

interface PageEntry {
  title: string;
  items: UpcomingItem[];
}

export const pageItemsStore = createStore<Readonly<Record<string, PageEntry>>>(
  readPageItems(loadStored<unknown>(PAGE_ITEMS, {})),
  'tools page items',
);

// The main window and popped-out tool windows each hold these lists: each follows the others' saves, so a save in
// one window never writes an older copy over what another window changed.
followStored(EXAMS, (value) => examsStore.set(readExams(value)));
followStored(TIMETABLE, (value) => timetableStore.set(readTimetable(value)));
followStored(PAGE_ITEMS, (value) => pageItemsStore.set(readPageItems(value)));

/** Reads the due dates written on a page and keeps them for Upcoming. Pages with none are forgotten. */
export function setPageItems(
  page: { id: string; title: string },
  blocks: readonly { id: string; markdown: string }[],
  context: { now: number; timeZone: string },
): void {
  const items: UpcomingItem[] = findPageDues(blocks, context).map((found) => ({
    id: `page:${page.id}:${found.block}:${found.line}`,
    title: found.title,
    due: found.due,
    done: found.done,
    page: { id: page.id, title: page.title, block: found.block, line: found.line },
  }));
  const current = pageItemsStore.get();
  const same = JSON.stringify(current[page.id]?.items ?? []) === JSON.stringify(items);
  if (same && (current[page.id]?.title ?? page.title) === page.title) return;
  const { [page.id]: _old, ...rest } = current;
  const next = items.length > 0 ? { ...rest, [page.id]: { title: page.title, items } } : rest;
  pageItemsStore.set(next);
  saveStored(PAGE_ITEMS, next);
}

export interface RemindersState {
  on: boolean;
  /** Reminders already announced, so each comes once. */
  sent: string[];
}

export const readReminders = (): RemindersState => {
  const saved = loadStored<Partial<RemindersState>>(REMINDERS, {});
  return { on: saved.on === true, sent: list<string>(saved.sent).slice(-200) };
};

export const writeReminders = (state: RemindersState): void =>
  saveStored(REMINDERS, { ...state, sent: state.sent.slice(-200) });

/** Today's key for the exams that sit beside the decks. */
export const todayKey = (now = Date.now()): string => {
  const date = new Date(now);
  return dateKey({ year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() });
};
