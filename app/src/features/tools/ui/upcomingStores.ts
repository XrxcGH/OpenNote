// What Upcoming remembers beyond its own list (Productivity and study tools): exam dates, the class timetable, the
// items read from lines on pages, and whether reminders are on. All of it stays on this device.
import { createStore } from '../../../state/store';
import type { ClassSlot, Exam } from '../upcoming';
import { dateKey, isClassSection, isExamTarget } from '../upcoming';
import { findPageDues } from '../upcoming/pageDue';
import type { UpcomingItem } from '../upcoming';
import { loadStored, saveStored } from './storage';

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

/** The exams saved on this device. */
export const loadExams = (): Exam[] =>
  list<Exam>(loadStored<unknown>(EXAMS, []))
    .filter((exam) => typeof exam?.id === 'string' && typeof exam.date === 'string')
    .map(readExam);

export const examsStore = createStore<readonly Exam[]>(loadExams(), 'tools exams');
/** A class as it was saved: a section link that is not valid is dropped, and the rest is kept. */
const readSlot = (slot: ClassSlot): ClassSlot => {
  const { section, ...rest } = slot;
  return isClassSection(section) ? { ...rest, section } : rest;
};

export const timetableStore = createStore<readonly ClassSlot[]>(
  list<ClassSlot>(loadStored<unknown>(TIMETABLE, []))
    .filter((slot) => typeof slot?.id === 'string' && Array.isArray(slot.days))
    .map(readSlot),
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
  loadStored<Record<string, PageEntry>>(PAGE_ITEMS, {}),
  'tools page items',
);

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
