// Exams, the class timetable, calendar-file updates, repeating to-dos, page due dates, and reminders.
import { describe, expect, it } from 'vitest';
import { parseDateKey } from './date';
import type { CivilDate } from './date';
import type { UpcomingItem } from './group';
import { parseIcs } from './ics';
import { parseDue } from './parseDue';
import { dueCandidate, findPageDues, formatDue, withDue } from './pageDue';
import {
  classesOn,
  daysLeft,
  examsAhead,
  followingItem,
  nextClass,
  nextDue,
  planIcsImport,
  updateFromFile,
} from './productivity';
import type { ClassSlot, Exam } from './productivity';
import { dueReminders } from './reminders';

const day = (key: string): CivilDate => parseDateKey(key)!;
const ZONE = 'UTC';
const NOW = Date.UTC(2026, 9, 7, 12, 0); // Wednesday 7 October 2026, noon

const ICS = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'UID:bio-lecture',
  'SUMMARY:Biology lecture',
  'DTSTART:20261005T090000Z',
  'DTEND:20261005T095000Z',
  'RRULE:FREQ=WEEKLY;BYDAY=MO,WE',
  'LOCATION:Room 204',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:midterm',
  'SUMMARY:Biology midterm exam',
  'DTSTART:20261020T140000Z',
  'END:VEVENT',
  'BEGIN:VTODO',
  'UID:essay',
  'SUMMARY:Essay draft',
  'DUE:20261015',
  'END:VTODO',
  'END:VCALENDAR',
].join('\r\n');

describe('exams', () => {
  const exams: Exam[] = [
    { id: 'a', name: 'Chemistry', date: '2026-10-20', time: '' },
    { id: 'b', name: 'Past', date: '2026-10-01', time: '' },
    { id: 'c', name: 'Today', date: '2026-10-07', time: '09:00' },
  ];
  it('count whole days and list the ones still ahead, soonest first', () => {
    expect(daysLeft(exams[0], day('2026-10-07'))).toBe(13);
    expect(examsAhead(exams, day('2026-10-07')).map((exam) => exam.name)).toEqual(['Today', 'Chemistry']);
  });
});

describe('the class timetable', () => {
  const slots: ClassSlot[] = [
    { id: '1', name: 'Biology', days: [1, 3], start: '09:00', end: '09:50', room: '204' },
    { id: '2', name: 'Chemistry', days: [3], start: '13:00', end: '14:15', room: '12' },
  ];
  it('lists a day in time order and finds the next class', () => {
    expect(classesOn(slots, day('2026-10-07')).map((slot) => slot.name)).toEqual(['Biology', 'Chemistry']);
    expect(nextClass(slots, NOW, ZONE)).toMatchObject({ slot: { name: 'Chemistry' }, date: day('2026-10-07') });
    const evening = Date.UTC(2026, 9, 7, 20, 0);
    expect(nextClass(slots, evening, ZONE)).toMatchObject({ slot: { name: 'Biology' }, date: day('2026-10-12') });
    expect(nextClass([], NOW, ZONE)).toBeNull();
  });
});

describe('a calendar file', () => {
  const range = { from: day('2026-10-01'), to: day('2026-12-31') };
  it('sorts into classes, exam dates, and assignments', () => {
    const plan = planIcsImport(parseIcs(ICS), range, ZONE, 'fall.ics');
    expect(plan.classes).toEqual([
      {
        id: 'ics:bio-lecture',
        name: 'Biology lecture',
        days: [1, 3],
        start: '09:00',
        end: '09:50',
        room: 'Room 204',
        source: 'fall.ics',
      },
    ]);
    expect(plan.exams).toMatchObject([
      { name: 'Biology midterm exam', date: '2026-10-20', time: '14:00', source: 'fall.ics' },
    ]);
    expect(plan.items.map((item) => item.title)).toEqual(['Essay draft']);
    expect(plan.items[0]).toMatchObject({ id: 'ics:essay', source: 'fall.ics' });
  });
  it('updates from a newer copy, keeping done marks and other sources', () => {
    const old: UpcomingItem[] = [
      { id: 'ics:a', title: 'A', due: null, done: true, source: 'f.ics' },
      { id: 'ics:b', title: 'B', due: null, done: false, source: 'f.ics' },
      { id: 'mine', title: 'Mine', due: null, done: false },
    ];
    const fresh: UpcomingItem[] = [
      { id: 'ics:a', title: 'A renamed', due: null, done: false, source: 'f.ics' },
      { id: 'ics:c', title: 'C', due: null, done: false, source: 'f.ics' },
    ];
    const result = updateFromFile(old, fresh, 'f.ics');
    expect(result).toMatchObject({ added: 1, removed: 1, changed: 1 });
    expect(result.next.map((item) => item.id)).toEqual(['mine', 'ics:a', 'ics:c']);
    expect(result.next.find((item) => item.id === 'ics:a')).toMatchObject({ title: 'A renamed', done: true });
  });
});

describe('repeating to-dos', () => {
  const due = { date: day('2026-10-01'), time: null };
  it('keep the rhythm without piling up missed repeats', () => {
    const daily = { every: 1, unit: 'day', mode: 'schedule' } as const;
    expect(nextDue(daily, due, day('2026-10-01')).date).toEqual(day('2026-10-02'));
    expect(nextDue(daily, due, day('2026-10-09')).date).toEqual(day('2026-10-10'));
    const weekly = { every: 1, unit: 'week', mode: 'schedule' } as const;
    expect(nextDue(weekly, due, day('2026-10-20')).date).toEqual(day('2026-10-22'));
    expect(nextDue(weekly, due, day('2026-09-20')).date).toEqual(day('2026-10-08'));
  });
  it('count from the finish day when asked', () => {
    const after = { every: 3, unit: 'day', mode: 'afterFinish' } as const;
    expect(nextDue(after, due, day('2026-10-09')).date).toEqual(day('2026-10-12'));
  });
  it('make the next item only for a repeating one', () => {
    const item: UpcomingItem = {
      id: 'u1',
      title: 'Water plants',
      due,
      done: true,
      repeat: { every: 1, unit: 'week', mode: 'schedule' },
    };
    expect(followingItem(item, day('2026-10-01'), 'u2')).toMatchObject({
      id: 'u2',
      done: false,
      due: { date: day('2026-10-08') },
    });
    expect(followingItem({ ...item, repeat: undefined }, day('2026-10-01'), 'u2')).toBeNull();
  });
});

describe('due dates on a page', () => {
  const context = { now: NOW, timeZone: ZONE };
  it('read checkbox lines and tagged lines', () => {
    expect(dueCandidate('- [ ] Read chapter 4 by Friday')).toEqual({ text: 'Read chapter 4 by Friday', done: false });
    expect(dueCandidate('- [x] Sent form')).toEqual({ text: 'Sent form', done: true });
    expect(dueCandidate('Call the bank Friday #todo')).toEqual({ text: 'Call the bank Friday', done: false });
    expect(dueCandidate('Just a note')).toBeNull();
    const found = findPageDues(
      [{ id: 'b1', markdown: 'intro\n- [ ] Read chapter 4 by Friday\n- [x] Pay rent 2026-10-09\n- [ ] no date here' }],
      context,
    );
    expect(found.map((one) => [one.line, one.title, one.done])).toEqual([
      [1, 'Read chapter 4', false],
      [2, 'Pay rent', true],
    ]);
  });
  it('write a new date that reads back the same', () => {
    const due = { date: day('2026-11-03'), time: { hour: 17, minute: 5 } };
    expect(formatDue(due)).toBe('2026-11-03 5:05 pm');
    const parsed = parseDue(formatDue(due), { now: NOW, timeZone: ZONE });
    expect(parsed).toEqual({ ok: true, due });
    expect(withDue('- [ ] Read by Friday', 'Friday', due)).toBe('- [ ] Read by 2026-11-03 5:05 pm');
    expect(withDue('- [ ] Read', 'Friday', due)).toBeNull();
  });
});

describe('reminders', () => {
  const timed = (id: string, hour: number): UpcomingItem => ({
    id,
    title: id,
    due: { date: day('2026-10-07'), time: { hour, minute: 0 } },
    done: false,
  });
  it('come once when a timed item reaches its time', () => {
    const items = [timed('now', 12), timed('later', 15), timed('old', 8), { ...timed('done', 12), done: true }];
    expect(dueReminders(items, NOW + 60_000, ZONE, new Set()).map((one) => one.title)).toEqual(['now']);
    const first = dueReminders(items, NOW + 60_000, ZONE, new Set());
    expect(dueReminders(items, NOW + 60_000, ZONE, new Set(first.map((one) => one.key)))).toEqual([]);
  });
  it('wait until the morning for an item with only a day', () => {
    const allDay: UpcomingItem = { id: 'a', title: 'a', due: { date: day('2026-10-07'), time: null }, done: false };
    expect(dueReminders([allDay], Date.UTC(2026, 9, 7, 6, 0), ZONE, new Set())).toEqual([]);
    expect(dueReminders([allDay], Date.UTC(2026, 9, 7, 9, 0), ZONE, new Set())).toHaveLength(1);
  });
});
