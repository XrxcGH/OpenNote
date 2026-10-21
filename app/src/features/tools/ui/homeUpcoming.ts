// What Home reads from Upcoming: the next few items, from the list kept on this device, the dates written on pages,
// the exams (including a deck's exam day), and the next class. Home loads this code only when its Upcoming section
// shows.
import { isEnabled } from '../../../app/flags';
import { decksStore } from '../../study';
import { soonest } from '../upcoming/homeList';
import { dueAt, examsAhead, nextClass, parseDateKey } from '../upcoming';
import type { ClassSlot, Exam, UpcomingItem } from '../upcoming';
import { loadStored } from './storage';
import { examsStore, pageItemsStore, timetableStore } from './upcomingStores';

const clock = (text: string) => {
  const found = /^(\d{1,2}):(\d{2})$/.exec(text);
  return found ? { hour: Number(found[1]), minute: Number(found[2]) } : null;
};

/** Exams ahead (a deck's exam day too, unless an exam is linked to that deck) as events with their dates. */
function examItems(now: number, timeZone: string): UpcomingItem[] {
  if (!isEnabled('tools.exams')) return [];
  const exams = examsStore.get();
  const linked = new Set(exams.map((exam) => exam.deck).filter(Boolean));
  const all: Exam[] = [
    ...exams,
    ...decksStore
      .get()
      .filter((deck) => deck.exam && !linked.has(deck.id))
      .map((deck): Exam => ({ id: `deck:${deck.id}`, name: deck.name, date: deck.exam!, time: '' })),
  ];
  const today = dueAt(now, timeZone).date;
  return examsAhead(all, today).flatMap((exam) => {
    const date = parseDateKey(exam.date);
    return date
      ? [
          {
            id: `exam:${exam.id}`,
            title: exam.name,
            due: { date, time: clock(exam.time) },
            done: false,
            kind: 'event' as const,
          },
        ]
      : [];
  });
}

/** The next class, as an event at its start time. */
function classItems(now: number, timeZone: string, slots: readonly ClassSlot[]): UpcomingItem[] {
  if (!isEnabled('tools.timetable')) return [];
  const next = nextClass(slots, now, timeZone);
  return next
    ? [
        {
          id: `class:${next.slot.id}:${next.date.year}-${next.date.month}-${next.date.day}`,
          title: next.slot.name,
          due: { date: next.date, time: clock(next.slot.start) },
          done: false,
          kind: 'event',
        },
      ]
    : [];
}

export function homeUpcoming(now = Date.now(), limit?: number): UpcomingItem[] {
  const saved = loadStored<{ items?: UpcomingItem[] }>('upcoming', {});
  const own = Array.isArray(saved.items) ? saved.items : [];
  const fromPages = Object.values(pageItemsStore.get()).flatMap((entry) => entry.items);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const extra = [...examItems(now, timeZone), ...classItems(now, timeZone, timetableStore.get())];
  return soonest([...own, ...fromPages, ...extra], { now, timeZone }, limit);
}
