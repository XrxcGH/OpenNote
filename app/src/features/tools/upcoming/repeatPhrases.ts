// Repeat phrases typed in a to-do: "every weekday", "every 2 weeks", "every Monday and Wednesday", "monthly on the 1st",
// "daily", "every other day", "yearly". The phrase is read, taken out of the text, and what is left goes on to the date
// parser. Text that does not clearly say how often is never guessed at.
import type { Weekday } from './date';
import type { Repeat } from './group';
import { WEEKDAYS } from './words';

export interface ParsedRepeat {
  repeat: Repeat;
  /** The words that said how often, as typed. */
  phrase: string;
  /** The text without them, with the gap closed. */
  rest: string;
}

const COUNTS = new Map<string, number>([
  ['other', 2],
  ['second', 2],
  ['two', 2],
  ['three', 3],
  ['four', 4],
  ['five', 5],
  ['six', 6],
  ['seven', 7],
  ['eight', 8],
  ['nine', 9],
  ['ten', 10],
  ['twelve', 12],
]);

const COUNT = '(\\d{1,3}|other|second|two|three|four|five|six|seven|eight|nine|ten|twelve)';
const DAY_NAME = [...WEEKDAYS.keys()].sort((a, b) => b.length - a.length).join('|');
const DAY_LIST = `(?:${DAY_NAME})(?:\\s*(?:,|/|&|and)\\s*(?:${DAY_NAME}))*`;
const NTH = '(\\d{1,2})(?:st|nd|rd|th)';

function count(word: string): number {
  return /^\d+$/.test(word) ? Number(word) : (COUNTS.get(word) ?? 1);
}

const schedule = (repeat: Omit<Repeat, 'mode'>): Repeat => ({ ...repeat, mode: 'schedule' });

type Rule = { pattern: RegExp; make(match: RegExpExecArray): Repeat | null };

// More specific phrases come first, so "every month on the 15th" is not read as just "every month".
const RULES: readonly Rule[] = [
  {
    pattern: /\b(?:every|each)\s+(?:week\s*day|weekday|work\s*day)s?\b|\bweek\s*days\b|\bon\s+weekdays\b/i,
    make: () => schedule({ every: 1, unit: 'weekday' }),
  },
  {
    pattern: new RegExp(`\\bon\\s+the\\s+${NTH}\\s+of\\s+(?:every|each)\\s+month\\b`, 'i'),
    make: (m) => dayOfMonthRule(1, Number(m[1])),
  },
  {
    pattern: /\b(?:monthly|every\s+month|each\s+month)\s+on\s+the\s+last\s+day\b/i,
    make: () => dayOfMonthRule(1, -1),
  },
  {
    pattern: new RegExp(`\\b(?:monthly|every\\s+month|each\\s+month)\\s+on\\s+(?:the\\s+|day\\s+)?${NTH}`, 'i'),
    make: (m) => dayOfMonthRule(1, Number(m[1])),
  },
  {
    pattern: new RegExp(`\\bevery\\s+${COUNT}\\s+months?\\b`, 'i'),
    make: (m) => schedule({ every: count(m[1].toLowerCase()), unit: 'month' }),
  },
  { pattern: /\b(?:monthly|every\s+month|each\s+month)\b/i, make: () => schedule({ every: 1, unit: 'month' }) },
  {
    pattern: /\b(?:yearly|annually|every\s+year|each\s+year)\b/i,
    make: () => schedule({ every: 12, unit: 'month' }),
  },
  {
    pattern: new RegExp(`\\bevery\\s+${COUNT}\\s+weeks?\\b`, 'i'),
    make: (m) => schedule({ every: count(m[1].toLowerCase()), unit: 'week' }),
  },
  {
    pattern: new RegExp(`\\b(?:every|each)\\s+(${DAY_LIST})s?\\b`, 'i'),
    make: (m) => {
      const days = m[1]
        .toLowerCase()
        .split(/\s*(?:,|\/|&|and)\s*/)
        .map((name) => WEEKDAYS.get(name))
        .filter((day): day is Weekday => day !== undefined);
      return days.length === 0 ? null : schedule({ every: 1, unit: 'week', days: [...new Set(days)].sort() });
    },
  },
  { pattern: /\b(?:weekly|every\s+week|each\s+week)\b/i, make: () => schedule({ every: 1, unit: 'week' }) },
  {
    pattern: new RegExp(`\\bevery\\s+${COUNT}\\s+days?\\b`, 'i'),
    make: (m) => schedule({ every: count(m[1].toLowerCase()), unit: 'day' }),
  },
  { pattern: /\b(?:daily|every\s+day|each\s+day)\b/i, make: () => schedule({ every: 1, unit: 'day' }) },
];

function dayOfMonthRule(every: number, day: number): Repeat | null {
  return day === -1 || (day >= 1 && day <= 31) ? schedule({ every, unit: 'month', dayOfMonth: day }) : null;
}

/** The text with the phrase cut out and the gap closed: no doubled spaces, no stranded "and", comma, or "on". */
function without(text: string, from: number, to: number): string {
  return `${text.slice(0, from)} ${text.slice(to)}`
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/(?:^|\s)(?:and|on|starting|from)\s*$/i, '')
    .replace(/[,;]\s*$/, '')
    .trim();
}

/** Reads how often a to-do repeats from the words in it, or null if it does not say. */
export function parseRepeat(text: string): ParsedRepeat | null {
  for (const rule of RULES) {
    const match = rule.pattern.exec(text);
    if (!match) continue;
    const repeat = rule.make(match);
    if (!repeat) continue;
    return { repeat, phrase: match[0], rest: without(text, match.index, match.index + match[0].length) };
  }
  return null;
}
