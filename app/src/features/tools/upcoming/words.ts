// The words the due-date parser knows, in en-US. Maps, not plain objects, so a word like "constructor" is never found.

import type { Weekday } from './date';

const months = [
  ['jan', 'january'],
  ['feb', 'february'],
  ['mar', 'march'],
  ['apr', 'april'],
  ['may', 'may'],
  ['jun', 'june'],
  ['jul', 'july'],
  ['aug', 'august'],
  ['sep', 'september'],
  ['oct', 'october'],
  ['nov', 'november'],
  ['dec', 'december'],
] as const;

/** Month names and abbreviations, with "sept", as 1 to 12. */
export const MONTHS: ReadonlyMap<string, number> = new Map([
  ...months.flatMap(([short, long], i) => [
    [short, i + 1],
    [long, i + 1],
  ]),
  ['sept', 9],
] as [string, number][]);

export const WEEKDAYS: ReadonlyMap<string, Weekday> = new Map<string, Weekday>([
  ['sun', 0],
  ['sunday', 0],
  ['mon', 1],
  ['monday', 1],
  ['tue', 2],
  ['tues', 2],
  ['tuesday', 2],
  ['wed', 3],
  ['weds', 3],
  ['wednesday', 3],
  ['thu', 4],
  ['thur', 4],
  ['thurs', 4],
  ['thursday', 4],
  ['fri', 5],
  ['friday', 5],
  ['sat', 6],
  ['saturday', 6],
]);

export const NUMBER_WORDS: ReadonlyMap<string, number> = new Map([
  ['a', 1],
  ['an', 1],
  ['one', 1],
  ['two', 2],
  ['three', 3],
  ['four', 4],
  ['five', 5],
  ['six', 6],
  ['seven', 7],
  ['eight', 8],
  ['nine', 9],
  ['ten', 10],
  ['eleven', 11],
  ['twelve', 12],
]);

export type DurationUnit = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

/** Units for "in 2 weeks". A single "m" is left out, because it could mean minutes or months. */
export const UNITS: ReadonlyMap<string, DurationUnit> = new Map<string, DurationUnit>([
  ...['min', 'mins', 'minute', 'minutes'].map((w) => [w, 'minute'] as const),
  ...['h', 'hr', 'hrs', 'hour', 'hours'].map((w) => [w, 'hour'] as const),
  ...['d', 'day', 'days'].map((w) => [w, 'day'] as const),
  ...['w', 'wk', 'wks', 'week', 'weeks'].map((w) => [w, 'week'] as const),
  ...['mo', 'mos', 'month', 'months'].map((w) => [w, 'month'] as const),
  ...['y', 'yr', 'yrs', 'year', 'years'].map((w) => [w, 'year'] as const),
]);

/** Words that can start a phrase without changing its meaning: "due Friday", "by 5 pm". */
export const FILLERS: ReadonlySet<string> = new Set(['due', 'by', 'on', 'before', 'until', 'for', 'at']);
