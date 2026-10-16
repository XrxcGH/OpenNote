// Date phrases: "tomorrow", "next Tuesday", "Oct 3", "in 2 weeks", "end of month", and more.
// Each recognizer takes the lowercase words of a phrase. It returns a date, or 'invalid-date' for a date that doesn't
// exist such as "Feb 30", or null if it doesn't recognize the words. The first recognizer to answer wins.
//
// Rules worth knowing:
// - A bare weekday ("Friday") is the next one after today. "This Friday" includes today. "Next Friday" is in the
//   following calendar week, which starts on the week-start day.
// - A month and day with no year ("Oct 3", "10/3") is the next one on or after today.
// - "End of week" is the last day of the current calendar week, the same day "This week" ends on.

import {
  addDays,
  addMonths,
  compareDates,
  dayOfWeek,
  endOfMonth,
  isValidDate,
  startOfWeek,
  type CivilDate,
  type ClockTime,
  type Weekday,
} from './date';
import { MONTHS, NUMBER_WORDS, UNITS, WEEKDAYS, type DurationUnit } from './words';
import { dueAt } from './zone';

export interface PhraseContext {
  /** The current instant, in milliseconds since 1970 UTC. */
  now: number;
  timeZone: string;
  weekStart: Weekday;
  /** The current date in the time zone. */
  today: CivilDate;
}

export interface PhraseValue {
  date: CivilDate;
  /** Set only by phrases that carry a time, such as "in 2 hours". */
  time?: ClockTime;
}

export type PhraseResult = PhraseValue | 'invalid-date' | null;

type Recognizer = (words: string[], context: PhraseContext) => PhraseResult;

const endOfWeek = (c: PhraseContext) => addDays(startOfWeek(c.today, c.weekStart), 6);
const nextSaturday = (c: PhraseContext) => addDays(c.today, (6 - dayOfWeek(c.today) + 7) % 7);

const KEYWORDS = new Map<string, (c: PhraseContext) => CivilDate>([
  ['today', (c) => c.today],
  ['tomorrow', (c) => addDays(c.today, 1)],
  ['tmrw', (c) => addDays(c.today, 1)],
  ['day after tomorrow', (c) => addDays(c.today, 2)],
  ['next week', (c) => addDays(c.today, 7)],
  ['next month', (c) => addMonths(c.today, 1)],
  ['next year', (c) => addMonths(c.today, 12)],
  ['weekend', nextSaturday],
  ['this weekend', nextSaturday],
  ['eow', endOfWeek],
  ['eom', (c) => endOfMonth(c.today)],
  ['eoy', (c) => ({ year: c.today.year, month: 12, day: 31 })],
]);

const keyword: Recognizer = (words, context) => {
  const find = KEYWORDS.get(words.join(' '));
  return find ? { date: find(context) } : null;
};

const weekday: Recognizer = (words, c) => {
  const target = WEEKDAYS.get(words[words.length - 1]);
  if (target === undefined || words.length > 2) return null;
  const modifier = words.length === 2 ? words[0] : '';
  if (modifier !== '' && modifier !== 'this' && modifier !== 'next') return null;
  if (modifier === 'next') {
    return { date: addDays(startOfWeek(c.today, c.weekStart), 7 + ((target - c.weekStart + 7) % 7)) };
  }
  const ahead = (target - dayOfWeek(c.today) + 7) % 7;
  return { date: addDays(c.today, modifier === 'this' ? ahead : ahead || 7) };
};

function quantity(word: string | undefined): number | null {
  if (word === undefined) return null;
  return NUMBER_WORDS.get(word) ?? (/^\d{1,5}$/.test(word) ? Number(word) : null);
}

const MINUTES: Partial<Record<DurationUnit, number>> = { minute: 60_000, hour: 3_600_000 };

function addDuration(amount: number, unit: DurationUnit, c: PhraseContext): PhraseValue {
  const length = MINUTES[unit];
  if (length !== undefined) {
    const { date, time } = dueAt(c.now + amount * length, c.timeZone);
    return { date, time: time ?? undefined };
  }
  if (unit === 'day') return { date: addDays(c.today, amount) };
  if (unit === 'week') return { date: addDays(c.today, amount * 7) };
  return { date: addMonths(c.today, unit === 'month' ? amount : amount * 12) };
}

/** "in 2 weeks", "in an hour", or "3 days from now". */
const relative: Recognizer = (words, c) => {
  const leading = words[0] === 'in' && words.length === 3;
  const trailing = words.length === 4 && words[2] === 'from' && (words[3] === 'now' || words[3] === 'today');
  if (!leading && !trailing) return null;
  const amount = quantity(leading ? words[1] : words[0]);
  const unit = UNITS.get(leading ? words[2] : words[1]);
  if (amount === null || unit === undefined) return null;
  return amount === 0 || amount > 10_000 ? 'invalid-date' : addDuration(amount, unit, c);
};

/** "end of month", "end of the week", and "end of next year". */
const endOf: Recognizer = (words, c) => {
  const match = /^end of (?:the )?(?:(this|next) )?(week|month|year)$/.exec(words.join(' '));
  if (!match) return null;
  const next = match[1] === 'next';
  if (match[2] === 'week') return { date: addDays(endOfWeek(c), next ? 7 : 0) };
  if (match[2] === 'month') return { date: endOfMonth(addMonths(c.today, next ? 1 : 0)) };
  return { date: { year: c.today.year + (next ? 1 : 0), month: 12, day: 31 } };
};

/** A month and day, with the year if given, or else the next one on or after today. */
function monthDay(month: number, day: number, year: number | null, today: CivilDate): PhraseResult {
  if (year !== null) {
    const date = { year, month, day };
    return isValidDate(date) ? { date } : 'invalid-date';
  }
  for (let y = today.year; y <= today.year + 8; y += 1) {
    const date = { year: y, month, day };
    if (isValidDate(date) && compareDates(date, today) >= 0) return { date };
  }
  return 'invalid-date';
}

const DAY = /^(\d{1,2})(?:st|nd|rd|th)?$/;
const YEAR = /^\d{4}$/;

/** Drops a leading weekday, so "Fri Oct 3" is "Oct 3". The date decides, and the weekday is ignored. */
function withoutWeekday(words: string[]): string[] {
  return words.length > 1 && WEEKDAYS.has(words[0]) ? words.slice(1) : words;
}

/** "Oct 3", "October 3rd, 2026", "3 Oct", and "the 3rd of October". */
const monthName: Recognizer = (all, c) => {
  const words = withoutWeekday(all).filter((w) => w !== 'the' && w !== 'of');
  const monthFirst = MONTHS.get(words[0]);
  const month = monthFirst ?? MONTHS.get(words[1]);
  const dayWord = monthFirst === undefined ? words[0] : words[1];
  const yearWord = words[2];
  const day = DAY.exec(dayWord ?? '');
  const shape = words.length === 2 || (words.length === 3 && YEAR.test(yearWord));
  if (month === undefined || !day || !shape) return null;
  return monthDay(month, Number(day[1]), words.length === 3 ? Number(yearWord) : null, c.today);
};

/** "10/3", "10/3/26", "10/3/2026", and "2026-10-03". */
const numeric: Recognizer = (all, c) => {
  const words = withoutWeekday(all);
  const iso = words.length === 1 ? /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(words[0]) : null;
  if (iso) return monthDay(Number(iso[2]), Number(iso[3]), Number(iso[1]), c.today);
  const us = words.length === 1 ? /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(words[0]) : null;
  if (!us) return null;
  const year = us[3] === undefined ? null : Number(us[3]) + (us[3].length === 2 ? 2000 : 0);
  return monthDay(Number(us[1]), Number(us[2]), year, c.today);
};

/** "the 15th": the next 15th, this month if it hasn't passed. */
const dayOfMonth: Recognizer = (all, c) => {
  const words = all.filter((w) => w !== 'the');
  const match = words.length === 1 ? /^(\d{1,2})(?:st|nd|rd|th)$/.exec(words[0]) : null;
  if (!match) return null;
  for (let ahead = 0; ahead <= 12; ahead += 1) {
    const first = addMonths({ ...c.today, day: 1 }, ahead);
    const date = { ...first, day: Number(match[1]) };
    if (isValidDate(date) && compareDates(date, c.today) >= 0) return { date };
  }
  return 'invalid-date';
};

const RECOGNIZERS: readonly Recognizer[] = [keyword, weekday, relative, endOf, monthName, numeric, dayOfMonth];

/** The date for a phrase's words, 'invalid-date', or null if no recognizer knows the words. */
export function parsePhrase(words: string[], context: PhraseContext): PhraseResult {
  for (const recognize of RECOGNIZERS) {
    const result = recognize(words, context);
    if (result !== null) return result;
  }
  return null;
}
