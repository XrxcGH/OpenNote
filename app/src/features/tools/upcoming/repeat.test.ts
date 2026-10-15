// Repeating to-dos typed in words: every weekday, every 2 weeks, every Monday and Wednesday, monthly on the 1st. The
// phrase is read and cut out; the rules give the next date and never land on a day that has passed.
import { describe, expect, it } from 'vitest';
import type { CivilDate } from './date';
import type { Repeat } from './group';
import { firstDue, followingItem, isRepeat, nextDue } from './productivity';
import { parseRepeat } from './repeatPhrases';

const day = (year: number, month: number, date: number): CivilDate => ({ year, month, day: date });
// 2026-10-07 is a Wednesday.
const WEDNESDAY = day(2026, 10, 7);

describe('parseRepeat', () => {
  const read = (text: string) => {
    const found = parseRepeat(text);
    return found && { repeat: found.repeat, rest: found.rest };
  };
  const every = (unit: Repeat['unit'], count = 1, extra: Partial<Repeat> = {}): Repeat => ({
    every: count,
    unit,
    mode: 'schedule',
    ...extra,
  });

  it('reads daily, weekday, weekly, monthly, and yearly phrases', () => {
    expect(read('Stretch daily')).toEqual({ repeat: every('day'), rest: 'Stretch' });
    expect(read('Stand-up every weekday')).toEqual({ repeat: every('weekday'), rest: 'Stand-up' });
    expect(read('Weekly review')).toEqual({ repeat: every('week'), rest: 'review' });
    expect(read('Pay rent monthly')).toEqual({ repeat: every('month'), rest: 'Pay rent' });
    expect(read('Renew the domain every year')).toEqual({ repeat: every('month', 12), rest: 'Renew the domain' });
  });

  it('reads a count: every 2 weeks, every other day, every three months', () => {
    expect(read('Water the plants every 2 weeks')).toEqual({ repeat: every('week', 2), rest: 'Water the plants' });
    expect(read('Floss every other day')).toEqual({ repeat: every('day', 2), rest: 'Floss' });
    expect(read('Backup every three months')).toEqual({ repeat: every('month', 3), rest: 'Backup' });
  });

  it('reads named weekdays, one or several, in any common spelling', () => {
    expect(read('Lab report every Friday')).toEqual({ repeat: every('week', 1, { days: [5] }), rest: 'Lab report' });
    expect(read('Gym every Mon, Wed and Fri')).toEqual({ repeat: every('week', 1, { days: [1, 3, 5] }), rest: 'Gym' });
    expect(read('Piano every tuesday & thursday')).toEqual({
      repeat: every('week', 1, { days: [2, 4] }),
      rest: 'Piano',
    });
  });

  it('reads a day of the month', () => {
    expect(read('Pay rent monthly on the 1st')).toEqual({
      repeat: every('month', 1, { dayOfMonth: 1 }),
      rest: 'Pay rent',
    });
    expect(read('Invoice on the 15th of every month')).toEqual({
      repeat: every('month', 1, { dayOfMonth: 15 }),
      rest: 'Invoice',
    });
    expect(read('Close the books every month on the last day')).toEqual({
      repeat: every('month', 1, { dayOfMonth: -1 }),
      rest: 'Close the books',
    });
  });

  it('keeps the date words for the date reader and closes the gap', () => {
    expect(read('Water plants every week, starting Friday')).toEqual({
      repeat: every('week'),
      rest: 'Water plants, starting Friday',
    });
  });

  it('does not guess at text that does not say how often', () => {
    for (const text of ['Read chapter 4', 'Call mom Friday', 'The weekday blues', 'every', 'Meet in 2 weeks'])
      expect(parseRepeat(text), text).toBeNull();
  });
});

describe('the next date of a repeat', () => {
  const schedule = (unit: Repeat['unit'], every = 1, extra: Partial<Repeat> = {}): Repeat => ({
    every,
    unit,
    mode: 'schedule',
    ...extra,
  });
  const next = (repeat: Repeat, from: CivilDate) => nextDue(repeat, { date: from, time: null }, WEDNESDAY).date;

  it('skips the weekend for a weekday repeat', () => {
    expect(next(schedule('weekday'), day(2026, 10, 9))).toEqual(day(2026, 10, 12));
    expect(next(schedule('weekday'), day(2026, 10, 7))).toEqual(day(2026, 10, 8));
  });

  it('goes to the next named weekday, and never to a day that has passed', () => {
    const mondayWednesday = schedule('week', 1, { days: [1, 3] });
    expect(next(mondayWednesday, day(2026, 10, 5))).toEqual(day(2026, 10, 12));
    // A task last due weeks ago lands on the first matching day after today, once.
    expect(next(mondayWednesday, day(2026, 9, 7))).toEqual(day(2026, 10, 12));
  });

  it('keeps the day of the month, and clamps it in a short month', () => {
    const monthly = schedule('month', 1, { dayOfMonth: 31 });
    expect(next(monthly, day(2026, 10, 31))).toEqual(day(2026, 11, 30));
    expect(nextDue(monthly, { date: day(2027, 1, 31), time: null }, day(2027, 1, 31)).date).toEqual(day(2027, 2, 28));
    expect(next(schedule('month', 1, { dayOfMonth: -1 }), day(2026, 10, 31))).toEqual(day(2026, 11, 30));
  });

  it('counts months and weeks by the number given', () => {
    expect(next(schedule('month', 3, { dayOfMonth: 1 }), day(2026, 10, 1))).toEqual(day(2027, 1, 1));
    expect(next(schedule('week', 2), day(2026, 10, 9))).toEqual(day(2026, 10, 23));
  });

  it('counts from the day of finishing when asked', () => {
    expect(nextDue({ every: 1, unit: 'month', mode: 'afterFinish' }, null, WEDNESDAY).date).toEqual(day(2026, 11, 7));
    expect(nextDue({ every: 1, unit: 'weekday', mode: 'afterFinish' }, null, day(2026, 10, 9)).date).toEqual(
      day(2026, 10, 12),
    );
  });

  it('keeps the time of day', () => {
    const due = { date: day(2026, 10, 9), time: { hour: 17, minute: 0 } };
    expect(nextDue(schedule('weekday'), due, WEDNESDAY).time).toEqual({ hour: 17, minute: 0 });
  });

  it('gives a to-do with no date its first day', () => {
    expect(firstDue(schedule('day'), WEDNESDAY).date).toEqual(WEDNESDAY);
    expect(firstDue(schedule('week', 1, { days: [5] }), WEDNESDAY).date).toEqual(day(2026, 10, 9));
    expect(firstDue(schedule('weekday'), day(2026, 10, 10)).date).toEqual(day(2026, 10, 12));
    expect(firstDue(schedule('month', 1, { dayOfMonth: 1 }), WEDNESDAY).date).toEqual(day(2026, 11, 1));
    expect(firstDue(schedule('month', 1, { dayOfMonth: 7 }), WEDNESDAY).date).toEqual(WEDNESDAY);
  });

  it('makes the following item with the day of the month fixed so a short month does not move it', () => {
    const item = {
      id: 'u1',
      title: 'Rent',
      done: false,
      due: { date: day(2026, 10, 31), time: null },
      repeat: schedule('month'),
    };
    const following = followingItem(item, WEDNESDAY, 'u2');
    expect(following?.repeat?.dayOfMonth).toBe(31);
    expect(following?.due?.date).toEqual(day(2026, 11, 30));
  });
});

describe('isRepeat', () => {
  it('accepts the new kinds and refuses a damaged one', () => {
    expect(isRepeat({ every: 1, unit: 'weekday', mode: 'schedule' })).toBe(true);
    expect(isRepeat({ every: 1, unit: 'week', mode: 'schedule', days: [1, 3] })).toBe(true);
    expect(isRepeat({ every: 1, unit: 'month', mode: 'schedule', dayOfMonth: -1 })).toBe(true);
    expect(isRepeat({ every: 1, unit: 'month', mode: 'schedule', dayOfMonth: 40 })).toBe(false);
    expect(isRepeat({ every: 1, unit: 'week', mode: 'schedule', days: [9] })).toBe(false);
    expect(isRepeat({ every: 1, unit: 'year', mode: 'schedule' })).toBe(false);
  });
});
