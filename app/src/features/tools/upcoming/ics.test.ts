import { describe, expect, it } from 'vitest';
import { dateKey, type CivilDate } from './date';
import { parseIcs } from './ics';
import { icsToItems } from './icsItems';
import { parseIcsTime } from './icsTime';
import { occurrenceDates, parseRule } from './recurrence';
import sample from './fixtures/sample.ics?raw';
import type { UpcomingItem } from './group';

const NY = 'America/New_York';
const OCTOBER = { from: { year: 2026, month: 10, day: 1 }, to: { year: 2026, month: 10, day: 31 } };

/** An item as "2026-10-05 10:00" or "2026-10-15" for all-day, or "undated". */
function when(item: UpcomingItem): string {
  if (!item.due) return 'undated';
  const { date, time } = item.due;
  const hours = time ? ` ${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}` : '';
  return dateKey(date) + hours;
}

const byTitle = (items: UpcomingItem[], title: string) => items.filter((i) => i.title === title);

const calendar = parseIcs(sample);

describe('reading an .ics file', () => {
  it('finds the events and to-dos and skips the rest', () => {
    expect(calendar.skipped).toBe(0);
    expect(calendar.components.map((c) => c.title)).toEqual([
      'Biology lecture',
      'Biology lecture (moved to the lab)',
      'Midterm exam, chapters 1-5 (bring a calculator)',
      'Office hours',
      'Guest talk',
      'Advisor meeting',
      'Lab report 2',
      'Read chapter 3',
      'Review flashcards',
      'Plan study abroad',
      'Turn in the old paper',
    ]);
    expect(calendar.components.filter((c) => c.kind === 'todo')).toHaveLength(5);
  });

  it('reads times, status, and repeat rules', () => {
    const [lecture, , midterm, hours, guest, advisor, lab, reading, cards, someday] = calendar.components;
    expect(lecture.when).toEqual({ date: { year: 2026, month: 10, day: 5 }, time: { hour: 10, minute: 0 }, zone: NY });
    expect(lecture.rule).toMatchObject({ freq: 'weekly', byDay: [1, 3], count: 6, interval: 1 });
    expect(lecture.exceptions).toHaveLength(1);
    expect(midterm.when).toEqual({ date: { year: 2026, month: 10, day: 15 }, time: null, zone: null });
    expect(hours.when).toMatchObject({ time: { hour: 19, minute: 0 }, zone: 'UTC' });
    expect(guest.canceled).toBe(true);
    expect(advisor).toMatchObject({ rule: null, ruleNote: 'monthly' });
    expect(lab).toMatchObject({ completed: false, when: { date: { day: 12 }, time: null } });
    expect(reading).toMatchObject({ completed: true, when: { time: { hour: 17 }, zone: null } });
    expect(cards.rule).toMatchObject({ freq: 'daily', interval: 2 });
    expect(someday.when).toBeNull();
  });
});

describe('reading odd files', () => {
  it('reads the same file with Windows line endings', () => {
    expect(parseIcs(sample.replace(/\n/g, '\r\n'))).toEqual(calendar);
  });

  it('counts what it cannot read and never throws', () => {
    const text = 'BEGIN:VCALENDAR\nnot a property\nBEGIN:VEVENT\nSUMMARY:No start\nEND:VEVENT\nEND:VCALENDAR';
    expect(parseIcs(text)).toEqual({ components: [], skipped: 2 });
    expect(parseIcs('')).toEqual({ components: [], skipped: 0 });
    expect(parseIcs('\u0000garbage\n\n:\nEND:VEVENT')).toMatchObject({ components: [] });
  });

  it('unescapes text, unfolds lines, and keeps colons and quoted parameters', () => {
    const text = [
      'BEGIN:VEVENT',
      'SUMMARY:Review\\; bring\\nnotes\\\\more: at 5',
      'DTSTART;X-NOTE="a:b";TZID=Europe/Paris:20261003T090000',
      'END:VEVENT',
    ].join('\n');
    const [event] = parseIcs(text).components;
    expect(event.title).toBe('Review; bring\nnotes\\more: at 5');
    expect(event.when).toMatchObject({ zone: 'Europe/Paris', time: { hour: 9 } });
  });
});

describe('date values', () => {
  it('reads dates, local times, UTC times, and zones', () => {
    expect(parseIcsTime('20261003')).toEqual({ date: { year: 2026, month: 10, day: 3 }, time: null, zone: null });
    expect(parseIcsTime('20261003T170000')).toMatchObject({ time: { hour: 17, minute: 0 }, zone: null });
    expect(parseIcsTime('20261003T170000Z')).toMatchObject({ zone: 'UTC' });
    expect(parseIcsTime('20261003T1700', { TZID: 'Asia/Tokyo' })).toMatchObject({ zone: 'Asia/Tokyo' });
    expect(parseIcsTime('20261003T170000', { VALUE: 'DATE' })).toMatchObject({ time: null });
  });

  it('knows common Windows zone names and treats unknown zones as floating', () => {
    expect(parseIcsTime('20261003T170000', { TZID: 'Eastern Standard Time' })?.zone).toBe(NY);
    expect(parseIcsTime('20261003T170000', { TZID: 'Nowhere/Atlantis' })?.zone).toBeNull();
  });

  it('rejects values that are not real', () => {
    for (const bad of ['', 'soon', '20261301', '20260230', '20261003T250000', '20261003T176000', '2026-10-03']) {
      expect(parseIcsTime(bad), bad).toBeNull();
    }
  });
});

const dates = (rule: string, start: CivilDate, from: CivilDate, to: CivilDate) => {
  const parsed = parseRule(rule).rule;
  return parsed ? [...occurrenceDates(start, parsed, { from, to })].map(dateKey) : [];
};
const day = (year: number, month: number, d: number): CivilDate => ({ year, month, day: d });

describe('repeat rules', () => {
  it('reads weekly rules with days, intervals, counts, and week starts', () => {
    expect(parseRule('FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10;INTERVAL=2;WKST=SU').rule).toEqual({
      freq: 'weekly',
      interval: 2,
      count: 10,
      until: null,
      byDay: [1, 3],
      weekStart: 0,
    });
    expect(parseRule('FREQ=WEEKLY;BYDAY=1MO,-1FR').rule?.byDay).toEqual([1, 5]);
    expect(parseRule('freq=daily;until=20261231T000000Z').rule).toMatchObject({
      freq: 'daily',
      until: { zone: 'UTC' },
    });
    expect(parseRule('FREQ=DAILY;INTERVAL=0;COUNT=x').rule).toMatchObject({ interval: 1, count: null });
  });

  it('notes the rules it does not expand', () => {
    expect(parseRule('FREQ=MONTHLY;BYMONTHDAY=1')).toEqual({ rule: null, note: 'monthly' });
    expect(parseRule('FREQ=YEARLY').note).toBe('yearly');
    expect(parseRule('nonsense')).toEqual({ rule: null, note: 'unknown' });
  });
});

describe('expanding repeat rules', () => {
  it('expands daily and weekly rules, jumping ahead when there is no count', () => {
    expect(dates('FREQ=DAILY', day(2020, 1, 1), day(2026, 10, 1), day(2026, 10, 3))).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
    ]);
    expect(dates('FREQ=DAILY;INTERVAL=3', day(2026, 9, 28), day(2026, 10, 1), day(2026, 10, 10))).toEqual([
      '2026-10-01',
      '2026-10-04',
      '2026-10-07',
      '2026-10-10',
    ]);
    expect(dates('FREQ=WEEKLY;INTERVAL=2', day(2026, 1, 5), day(2026, 10, 1), day(2026, 10, 31))).toEqual([
      '2026-10-12',
      '2026-10-26',
    ]);
    expect(dates('FREQ=WEEKLY;BYDAY=SA,SU', day(2026, 10, 3), day(2026, 10, 1), day(2026, 10, 12))).toEqual([
      '2026-10-03',
      '2026-10-04',
      '2026-10-10',
      '2026-10-11',
    ]);
    expect(dates('FREQ=DAILY;BYDAY=MO,FR', day(2026, 10, 1), day(2026, 10, 1), day(2026, 10, 9))).toEqual([
      '2026-10-02',
      '2026-10-05',
      '2026-10-09',
    ]);
  });

  it('counts from the start of the series, even when the window is later', () => {
    const rule = 'FREQ=DAILY;COUNT=5';
    expect(dates(rule, day(2026, 9, 28), day(2026, 10, 1), day(2026, 12, 31))).toEqual(['2026-10-01', '2026-10-02']);
    expect(dates('FREQ=WEEKLY;BYDAY=MO,WE;COUNT=3', day(2026, 10, 5), day(2026, 10, 1), day(2026, 12, 1))).toEqual([
      '2026-10-05',
      '2026-10-07',
      '2026-10-12',
    ]);
  });

  it('stops a day after the end date, and leaves the exact cut to the caller', () => {
    expect(dates('FREQ=DAILY;UNTIL=20261003', day(2026, 10, 1), day(2026, 10, 1), day(2026, 12, 31))).toHaveLength(4);
  });
});

const items = icsToItems(calendar, OCTOBER, NY);

describe('items for a window of dates', () => {
  it('expands the repeats, skips exceptions, and swaps in edited occurrences', () => {
    const lectures = items.filter((i) => i.title.startsWith('Biology lecture'));
    expect(lectures.map((i) => [i.id, when(i)])).toEqual([
      ['bio-lecture@example.test#2026-10-05', '2026-10-05 10:00'],
      ['bio-lecture@example.test#2026-10-12', '2026-10-12 10:00'],
      ['bio-lecture@example.test#2026-10-19', '2026-10-19 10:00'],
      ['bio-lecture@example.test#2026-10-21', '2026-10-21 10:00'],
      ['bio-lecture@example.test#2026-10-14', '2026-10-14 13:00'],
    ]);
    expect(lectures.every((i) => i.kind === 'event')).toBe(true);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it('ends a repeat at its end date in the right zone', () => {
    const cards = byTitle(items, 'Review flashcards');
    expect(cards.map(when)).toEqual(['2026-10-01 21:00', '2026-10-03 21:00', '2026-10-05 21:00', '2026-10-07 21:00']);
    expect(cards.every((i) => i.kind === 'task' && !i.done)).toBe(true);
  });
});

describe('one-time items and to-dos', () => {
  it('puts one-time items on their dates, in the viewer zone', () => {
    expect(byTitle(items, 'Midterm exam, chapters 1-5 (bring a calculator)').map(when)).toEqual(['2026-10-15']);
    expect(byTitle(items, 'Office hours').map(when)).toEqual(['2026-10-08 15:00']);
    expect(byTitle(items, 'Advisor meeting').map(when)).toEqual(['2026-10-20 10:00']);
    expect(byTitle(items, 'Guest talk')).toEqual([]);
    const tokyo = icsToItems(calendar, OCTOBER, 'Asia/Tokyo');
    expect(byTitle(tokyo, 'Office hours').map(when)).toEqual(['2026-10-09 04:00']);
    expect(byTitle(tokyo, 'Biology lecture').map(when)[0]).toBe('2026-10-05 23:00');
  });

  it('keeps to-dos that are not done, even old ones, and marks finished ones', () => {
    expect(byTitle(items, 'Turn in the old paper').map(when)).toEqual(['2026-09-15']);
    expect(byTitle(items, 'Plan study abroad')).toMatchObject([{ due: null, kind: 'task', done: false }]);
    expect(byTitle(items, 'Read chapter 3')).toMatchObject([{ done: true }]);
    expect(byTitle(items, 'Lab report 2')).toMatchObject([{ done: false }]);
  });

  it('leaves out events and finished to-dos that are outside the window', () => {
    const november = { from: { year: 2026, month: 11, day: 1 }, to: { year: 2026, month: 11, day: 30 } };
    const later = icsToItems(calendar, november, NY);
    expect(later.map((i) => i.title)).toEqual(['Lab report 2', 'Plan study abroad', 'Turn in the old paper']);
    const firstTwoDays = { from: OCTOBER.from, to: { ...OCTOBER.from, day: 2 } };
    expect(icsToItems(calendar, firstTwoDays, NY).map((i) => i.title)).toEqual([
      'Review flashcards',
      'Plan study abroad',
      'Turn in the old paper',
    ]);
  });
});

describe('repeats across daylight saving time', () => {
  it('keeps a repeating class at the same local time across daylight saving time', () => {
    const text = [
      'BEGIN:VEVENT',
      'UID:class',
      'SUMMARY:Class',
      'DTSTART;TZID=America/New_York:20261026T100000',
      'RRULE:FREQ=WEEKLY',
      'END:VEVENT',
    ].join('\n');
    const range = { from: { year: 2026, month: 10, day: 26 }, to: { year: 2026, month: 11, day: 9 } };
    expect(icsToItems(parseIcs(text), range, NY).map(when)).toEqual([
      '2026-10-26 10:00',
      '2026-11-02 10:00',
      '2026-11-09 10:00',
    ]);
    // In UTC the same class is 14:00 before the clocks change and 15:00 after.
    expect(icsToItems(parseIcs(text), range, 'UTC').map(when)).toEqual([
      '2026-10-26 14:00',
      '2026-11-02 15:00',
      '2026-11-09 15:00',
    ]);
  });
});
