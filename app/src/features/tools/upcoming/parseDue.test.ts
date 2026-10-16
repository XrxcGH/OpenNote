// checks-disable-file modifiability: table-driven cases repeat the same call by design

import { describe, expect, it } from 'vitest';
import type { Weekday } from './date';
import { findDue, parseDue, type ParseContext } from './parseDue';
import { toInstant } from './zone';

const NY = 'America/New_York';
// Thursday, October 1, 2026, at 10:00 in New York.
const NOW = toInstant({ year: 2026, month: 10, day: 1 }, { hour: 10, minute: 0 }, NY);
const context = (weekStart?: Weekday): ParseContext => ({ now: NOW, timeZone: NY, weekStart });

/** The result as "2026-10-02" for a date only, or "2026-10-02 17:00" for a date with a time. */
function read(text: string, weekStart?: Weekday): string {
  const result = parseDue(text, context(weekStart));
  if (!result.ok) return `! ${result.reason}`;
  const { date, time } = result.due;
  const day = [date.year, String(date.month).padStart(2, '0'), String(date.day).padStart(2, '0')].join('-');
  return time ? `${day} ${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}` : day;
}

/** Checks a table with one "text => result" case per line. */
function expectAll(table: string, weekStart?: Weekday): void {
  for (const line of table.split('\n').filter((l) => l.trim() !== '')) {
    const [text, expected] = line.split('=>').map((part) => part.trim());
    expect(read(text, weekStart), text).toBe(expected);
  }
}

/** Declares a test that checks a table of cases. */
function cases(name: string, table: string, weekStart?: Weekday): void {
  it(name, () => expectAll(table, weekStart));
}

describe('named days', () => {
  cases(
    'reads today, tomorrow, and weekdays',
    `
      today => 2026-10-01
      tomorrow => 2026-10-02
      Tomorrow! => 2026-10-02
      day after tomorrow => 2026-10-03
      friday => 2026-10-02
      Fri => 2026-10-02
      sat => 2026-10-03
      monday => 2026-10-05
      thursday => 2026-10-08
      by Friday => 2026-10-02
      due on friday => 2026-10-02
    `,
  );

  cases(
    'reads this and next, by calendar week',
    `
      this thursday => 2026-10-01
      this friday => 2026-10-02
      this monday => 2026-10-05
      next tuesday => 2026-10-06
      next friday => 2026-10-09
      next thursday => 2026-10-08
      next monday => 2026-10-05
      next week => 2026-10-08
      next month => 2026-11-01
      weekend => 2026-10-03
    `,
  );
  cases('counts next weekdays from a Monday week start', 'next monday => 2026-10-05\nnext sunday => 2026-10-11', 1);
});

describe('dates', () => {
  cases(
    'reads month names in several orders',
    `
      Oct 3 => 2026-10-03
      october 3rd => 2026-10-03
      3 Oct => 2026-10-03
      the 3rd of October => 2026-10-03
      Friday, Oct 9 => 2026-10-09
      Oct 3, 2027 => 2027-10-03
      sept 15 2026 => 2026-09-15
      Dec 25 => 2026-12-25
    `,
  );

  cases(
    'uses the next one on or after today when there is no year',
    `
      Oct 1 => 2026-10-01
      Sep 30 => 2027-09-30
      jan 5 => 2027-01-05
      feb 29 => 2028-02-29
      10/1 => 2026-10-01
      9/30 => 2027-09-30
    `,
  );

  cases(
    'reads numeric and ISO dates',
    `
      10/3 => 2026-10-03
      10/3/26 => 2026-10-03
      10/3/2026 => 2026-10-03
      2026-10-03 => 2026-10-03
      2026-1-5 => 2026-01-05
      15th => 2026-10-15
      the 1st => 2026-10-01
      1st => 2026-10-01
      31st => 2026-10-31
    `,
  );

  cases(
    'rejects dates that do not exist',
    `
      Feb 30 => ! invalid-date
      Apr 31 => ! invalid-date
      13/45 => ! invalid-date
      2/29/2027 => ! invalid-date
      oct 0 => ! invalid-date
    `,
  );
});

describe('relative phrases', () => {
  it('reads "in 2 weeks" and its variants', () => {
    expectAll(`
      in 2 weeks => 2026-10-15
      in 3 days => 2026-10-04
      in a week => 2026-10-08
      in two months => 2026-12-01
      in 1 year => 2027-10-01
      2 days from now => 2026-10-03
      in an hour => 2026-10-01 11:00
      in 90 minutes => 2026-10-01 11:30
      in 14 hrs => 2026-10-02 00:00
      in 0 days => ! invalid-date
      in 99999 days => ! invalid-date
      in 999999 days => ! unrecognized
    `);
  });

  it('reads the end of a period', () => {
    expectAll(`
      end of month => 2026-10-31
      end of the month => 2026-10-31
      end of next month => 2026-11-30
      eom => 2026-10-31
      end of week => 2026-10-03
      end of next week => 2026-10-10
      end of year => 2026-12-31
    `);
  });
  it('ends the week on Sunday when weeks start on Monday', () => {
    expectAll('end of week => 2026-10-04', 1);
  });
});

describe('times', () => {
  cases(
    'reads a time with a day',
    `
      Fri 5 PM => 2026-10-02 17:00
      Friday at 5pm => 2026-10-02 17:00
      5 PM Friday => 2026-10-02 17:00
      tomorrow 3:30 p.m. => 2026-10-02 15:30
      Oct 3 at 11:59 PM => 2026-10-03 23:59
      10/3 11:59pm => 2026-10-03 23:59
      2026-10-03 14:05 => 2026-10-03 14:05
      next Tuesday at noon => 2026-10-06 12:00
      today 12 am => 2026-10-01 00:00
      today 12:15 pm => 2026-10-01 12:15
    `,
  );

  cases(
    'reads a time alone as the next time it happens',
    `
      5 PM => 2026-10-01 17:00
      by 5pm => 2026-10-01 17:00
      9 am => 2026-10-02 09:00
      10 am => 2026-10-01 10:00
      noon => 2026-10-01 12:00
      17:30 => 2026-10-01 17:30
      5:30 => 2026-10-02 05:30
    `,
  );

  cases(
    'rejects times that do not exist and bare numbers',
    `
      25:00 => ! invalid-time
      13 pm => ! invalid-time
      0 am => ! invalid-time
      tomorrow 9:75 am => ! invalid-time
      5 => ! unrecognized
    `,
  );
});

describe('time zones and odd input', () => {
  it('uses the date in the given zone, not in UTC', () => {
    // 10:00 in New York is 03:00 the next day in Auckland.
    expect(parseDue('today', { now: NOW, timeZone: 'Pacific/Auckland' })).toMatchObject({
      ok: true,
      due: { date: { year: 2026, month: 10, day: 2 } },
    });
    expect(parseDue('5 pm', { now: NOW, timeZone: 'Pacific/Auckland' })).toMatchObject({
      due: { date: { day: 2 }, time: { hour: 17 } },
    });
  });

  it('gives a reason when it cannot read the text', () => {
    expectAll(`
      => ! empty
      by => ! empty
      whenever => ! unrecognized
      oct => ! unrecognized
      next => ! unrecognized
      constructor => ! unrecognized
      __proto__ 5 pm => ! unrecognized
      friday friday => ! unrecognized
    `);
    expect(read('   ')).toBe('! empty');
  });
});

describe('finding a date at the end of a sentence', () => {
  const find = (text: string) => findDue(text, context());

  it('splits the title from the date phrase', () => {
    expect(find('Read chapter 5 by Friday 5 PM')).toMatchObject({
      title: 'Read chapter 5',
      phrase: 'by Friday 5 PM',
      due: { date: { month: 10, day: 2 }, time: { hour: 17, minute: 0 } },
    });
    expect(find('Essay due Oct 3')).toMatchObject({ title: 'Essay', phrase: 'due Oct 3' });
    expect(find('Email Dr. Lee tomorrow')).toMatchObject({ title: 'Email Dr. Lee' });
    expect(find('Meet Bob at 5 pm')).toMatchObject({ title: 'Meet Bob', due: { date: { day: 1 } } });
    expect(find('tomorrow')).toMatchObject({ title: '' });
    expect(find('Buy milk in 2 weeks')).toMatchObject({ title: 'Buy milk', due: { date: { month: 10, day: 15 } } });
  });

  it('finds nothing when the sentence has no date', () => {
    expect(find('Buy milk')).toBeNull();
    expect(find('Chapter 5')).toBeNull();
    expect(find('Read 5 pages')).toBeNull();
    expect(find('')).toBeNull();
  });
});
