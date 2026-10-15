// What Upcoming remembers beyond its own list (Productivity and study tools): exam dates, the class timetable, the
// items read from lines on pages, and whether reminders are on. All of it stays on this device.
import { createStore } from '../../../state/store';
import type { ClassSlot, Exam } from '../upcoming';
import { dateKey, isClassSection, isExamTarget } from '../upcoming';
import { findPageDues } from '../upcoming/pageDue';
import type { UpcomingItem } from '../upcoming';
import { followStored, loadStored, saveStored } from './storage';

const EXAMS = 'exams';
const TIMETABLE = 'timetable';
const PAGE_ITEMS = 'pageItems';
export const REMINDERS = 'reminders';

const list = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

/** An exam as it was saved: a target that is not valid is dropped, and the rest is kept. */
const readExam = (exam: Exam): Exam => {
  const { target, ...rest } = exam;
  return isExamTarget(target) ? { ...rest, target } : rest;
};
/** A class as it was saved: a section link that is not valid is dropped, and the rest is kept. */
const readSlot = (slot: ClassSlot): ClassSlot => {
  const { section, ...rest } = slot;
  return isClassSection(section) ? { ...rest, section } : rest;
};

const readExams = (value: unknown): Exam[] =>
  list<Exam>(value)
    .filter((exam) => typeof exam?.id === 'string' && typeof exam.date === 'string')
    .map(readExam);
const readTimetable = (value: unknown): ClassSlot[] =>
  list<ClassSlot>(value)
    .filter((slot) => typeof slot?.id === 'string' && Array.isArray(slot.days))
    .map(readSlot);
const readPageItems = (value: unknown): Record<string, PageEntry> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, PageEntry>) : {};

/** The exams saved on this device. */
export const loadExams = (): Exam[] => readExams(loadStored<unknown>(EXAMS, []));

export const examsStore = createStore<readonly Exam[]>(loadExams(), 'tools exams');
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

export interface PageEntry {
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

/** The items for the due dates written on a page's text blocks. */
export function pageItemsOf(
  page: { id: string; title: string },
  blocks: readonly { id: string; markdown: string }[],
  context: { now: number; timeZone: string },
): UpcomingItem[] {
  return findPageDues(blocks, context).map((found) => ({
    id: `page:${page.id}:${found.block}:${found.line}`,
    title: found.title,
    due: found.due,
    done: found.done,
    ...(found.repeat ? { repeat: found.repeat } : {}),
    page: { id: page.id, title: page.title, block: found.block, line: found.line, task: found.task },
  }));
}

/**
 * Replaces what Upcoming knows of every page with a new reading, except the pages named in `keep` (the page that is
 * open, which is read from the editor as it changes). Pages with no due dates are forgotten.
 */
export function replacePageItems(entries: Readonly<Record<string, PageEntry>>, keep: readonly string[] = []): void {
  const current = pageItemsStore.get();
  const next: Record<string, PageEntry> = { ...entries };
  for (const id of keep) {
    if (current[id]) next[id] = current[id];
    else delete next[id];
  }
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  pageItemsStore.set(next);
  saveStored(PAGE_ITEMS, next);
}

/** Marks one page item done or open in what Upcoming holds, until the next reading of its page. */
export function markPageItem(id: string, done: boolean): void {
  const current = pageItemsStore.get();
  const next = Object.fromEntries(
    Object.entries(current).map(([page, entry]) => [
      page,
      { ...entry, items: entry.items.map((item) => (item.id === id ? { ...item, done } : item)) },
    ]),
  );
  pageItemsStore.set(next);
  saveStored(PAGE_ITEMS, next);
}

/** Reads the due dates written on a page and keeps them for Upcoming. Pages with none are forgotten. */
export function setPageItems(
  page: { id: string; title: string },
  blocks: readonly { id: string; markdown: string }[],
  context: { now: number; timeZone: string },
): void {
  const items = pageItemsOf(page, blocks, context);
  const current = pageItemsStore.get();
  const same = JSON.stringify(current[page.id]?.items ?? []) === JSON.stringify(items);
  if (same && (current[page.id]?.title ?? page.title) === page.title) return;
  const { [page.id]: _old, ...rest } = current;
  const next = items.length > 0 ? { ...rest, [page.id]: { title: page.title, items } } : rest;
  pageItemsStore.set(next);
  saveStored(PAGE_ITEMS, next);
}

/** Forgets what these pages fed Upcoming, so nothing of a protected page stays in browser storage (ADR 0042). */
export function forgetPageItems(pageIds: readonly string[]): void {
  const current = pageItemsStore.get();
  if (!pageIds.some((id) => id in current)) return;
  const next = Object.fromEntries(Object.entries(current).filter(([id]) => !pageIds.includes(id)));
  pageItemsStore.set(next);
  saveStored(PAGE_ITEMS, next);
}

export interface RemindersState {
  on: boolean;
  /** Reminders already announced, so each comes once. */
  sent: string[];
  /** The page lines the person asked a reminder for, by their reminder keys. */
  pageLines: string[];
}

export const readReminders = (): RemindersState => {
  const saved = loadStored<Partial<RemindersState>>(REMINDERS, {});
  return {
    on: saved.on === true,
    sent: list<string>(saved.sent).slice(-200),
    pageLines: list<string>(saved.pageLines),
  };
};

export const writeReminders = (state: RemindersState): void =>
  saveStored(REMINDERS, { ...state, sent: state.sent.slice(-200) });

/** Today's key for the exams that sit beside the decks. */
export const todayKey = (now = Date.now()): string => {
  const date = new Date(now);
  return dateKey({ year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() });
};
