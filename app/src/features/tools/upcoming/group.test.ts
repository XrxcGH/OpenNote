import { describe, expect, it } from 'vitest';
import { bucketByDay, isBetween, monthGrid, shiftMonth, weekGrid } from './calendar';
import type { CivilDate, Due } from './date';
import { classifyDue, groupUpcoming, type UpcomingItem } from './group';
import { toInstant } from './zone';

const NY = 'America/New_York';
const TODAY: CivilDate = { year: 2026, month: 10, day: 1 };
// Thursday, October 1, 2026, at 10:00 in New York.
const NOW = toInstant(TODAY, { hour: 10, minute: 0 }, NY);
const context = { now: NOW, timeZone: NY };

function due(month: number, day: number, time?: string): Due {
  const [hour, minute] = time ? time.split(':').map(Number) : [0, 0];
  return { date: { year: 2026, month, day }, time: time ? { hour, minute } : null };
}

function item(id: string, dueDate: Due | null, extra: Partial<UpcomingItem> = {}): UpcomingItem {
  return { id, title: id, due: dueDate, done: false, ...extra };
}

const items = [
  item('later-oct-20', due(10, 20)),
  item('sat', due(10, 3)),
  item('today-5pm', due(10, 1, '17:00')),
  item('no-date', null),
  item('yesterday-5pm', due(9, 30, '17:00')),
  item('done-old', due(9, 1), { done: true }),
  item('today-all-day', due(10, 1)),
  item('today-9am', due(10, 1, '09:00')),
  item('last-week', due(9, 24)),
  item('sun', due(10, 4)),
  item('next-year', { date: { year: 2027, month: 1, day: 2 }, time: null }),
];

describe('grouping', () => {
  it('puts each item in the right group, in date order', () => {
    const groups = groupUpcoming(items, context);
    const ids = (list: UpcomingItem[]) => list.map((i) => i.id);
    expect(ids(groups.overdue)).toEqual(['last-week', 'yesterday-5pm', 'today-9am']);
    expect(ids(groups.today)).toEqual(['today-all-day', 'today-5pm']);
    expect(ids(groups.thisWeek)).toEqual(['sat']);
    expect(ids(groups.later)).toEqual(['sun', 'later-oct-20', 'next-year']);
    expect(ids(groups.undated)).toEqual(['no-date']);
  });

  it('ends the week on the day before the week-start day', () => {
    const monday = groupUpcoming(items, { ...context, weekStart: 1 });
    expect(monday.thisWeek.map((i) => i.id)).toEqual(['sat', 'sun']);
    expect(monday.later.map((i) => i.id)).toEqual(['later-oct-20', 'next-year']);
  });

  it('leaves out done items unless asked', () => {
    expect(groupUpcoming(items, context).overdue.map((i) => i.id)).not.toContain('done-old');
    const all = groupUpcoming(items, context, { includeDone: true });
    expect(all.overdue.map((i) => i.id)[0]).toBe('done-old');
  });
});

describe('grouping by day and zone', () => {
  it('keeps a date-only item out of overdue until its day is over', () => {
    const lateTonight = toInstant(TODAY, { hour: 23, minute: 59 }, NY);
    const tomorrow = toInstant({ ...TODAY, day: 2 }, { hour: 0, minute: 1 }, NY);
    expect(classifyDue(due(10, 1), { ...context, now: lateTonight })).toBe('today');
    expect(classifyDue(due(10, 1), { ...context, now: tomorrow })).toBe('overdue');
  });

  it('uses the viewer zone for what today is', () => {
    // 10:00 in New York is 15:00 in London, the same day. In Auckland it is already the next morning.
    expect(classifyDue(due(10, 1), { now: NOW, timeZone: 'Europe/London' })).toBe('today');
    expect(classifyDue(due(10, 1), { now: NOW, timeZone: 'Pacific/Auckland' })).toBe('overdue');
    expect(classifyDue(due(10, 2), { now: NOW, timeZone: 'Pacific/Auckland' })).toBe('today');
  });

  it('breaks ties by title', () => {
    const tied = groupUpcoming([item('b', due(10, 20)), item('a', due(10, 20))], context);
    expect(tied.later.map((i) => i.id)).toEqual(['a', 'b']);
  });
});

describe('calendar grids', () => {
  it('builds a month of full weeks', () => {
    const grid = monthGrid(2026, 10, TODAY);
    expect(grid).toHaveLength(5);
    expect(grid.every((week) => week.length === 7)).toBe(true);
    expect(grid[0][0].key).toBe('2026-09-27');
    expect(grid[0][0].inMonth).toBe(false);
    expect(grid[0][4]).toMatchObject({ key: '2026-10-01', inMonth: true, today: true, weekend: false });
    expect(grid[4][6]).toMatchObject({ key: '2026-10-31', inMonth: true, weekend: true });
    expect(grid.flat().filter((d) => d.today)).toHaveLength(1);
    expect(grid.flat().filter((d) => d.inMonth)).toHaveLength(31);
  });

  it('follows the week-start day and the row count', () => {
    expect(monthGrid(2026, 10, TODAY, { weekStart: 1 })[0][0].key).toBe('2026-09-28');
    expect(monthGrid(2026, 2, TODAY)).toHaveLength(4);
    expect(monthGrid(2026, 2, TODAY, { rows: 6 })).toHaveLength(6);
    expect(monthGrid(2026, 8, TODAY)).toHaveLength(6);
    expect(monthGrid(2026, 8, TODAY, { weekStart: 1 })).toHaveLength(6);
    expect(monthGrid(2026, 12, TODAY)[4][6].key).toBe('2027-01-02');
  });
});

describe('week grids and buckets', () => {
  it('builds a week around a date', () => {
    const week = weekGrid({ year: 2026, month: 10, day: 7 }, TODAY);
    expect(week.map((d) => d.key)).toEqual([
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
    ]);
    expect(week.map((d) => d.weekend)).toEqual([true, false, false, false, false, false, true]);
    expect(weekGrid(TODAY, TODAY, 1)[3].today).toBe(true);
  });

  it('shifts months across year boundaries', () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth(2026, 10, 15)).toEqual({ year: 2028, month: 1 });
  });

  it('puts items on their days in time order', () => {
    const days = bucketByDay([
      item('evening', due(10, 1, '18:00')),
      item('other-day', due(10, 2)),
      item('no-date', null),
      item('all-day', due(10, 1)),
      item('morning', due(10, 1, '08:00')),
    ]);
    expect(days.get('2026-10-01')?.map((i) => i.id)).toEqual(['all-day', 'morning', 'evening']);
    expect(days.get('2026-10-02')?.map((i) => i.id)).toEqual(['other-day']);
    expect(days.size).toBe(2);
  });

  it('checks whether a date is in a range', () => {
    expect(isBetween(TODAY, TODAY, TODAY)).toBe(true);
    expect(isBetween({ ...TODAY, day: 2 }, TODAY, TODAY)).toBe(false);
  });
});
