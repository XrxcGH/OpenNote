// Turns typed text such as "Fri 5 PM" or "in 2 weeks" into a due date and time. It is relative to an injected "now"
// and time zone, so it is testable and right in any zone. Text that isn't a date and time is never guessed at.

import { addDays, type ClockTime, type Due, type Weekday } from './date';
import { parsePhrase, type PhraseContext } from './phrases';
import { extractTime } from './time';
import { FILLERS } from './words';
import { dateIn, toInstant } from './zone';

export interface ParseContext {
  /** The current instant, in milliseconds since 1970 UTC. */
  now: number;
  /** An IANA time zone name, such as "America/Chicago". */
  timeZone: string;
  /** The first day of the week, 0 for Sunday, as in en-US. It sets what "next Tuesday" and "this week" mean. */
  weekStart?: Weekday;
}

export type ParseFailure = 'empty' | 'unrecognized' | 'invalid-date' | 'invalid-time';

export type ParseResult = { ok: true; due: Due } | { ok: false; reason: ParseFailure };

const fail = (reason: ParseFailure): ParseResult => ({ ok: false, reason });

/** Lowercase, with single spaces, no commas, no trailing punctuation, and "a.m." as "am". */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b([ap])\.m\b\.?/g, '$1m')
    .replace(/[,;]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[.!?:\s]+$/, '')
    .trim();
}

/** The words of a phrase, without "due", "by", "on", and similar words at the start. */
function contentWords(text: string): string[] {
  const words = text.split(' ').filter((w) => w !== '');
  while (words.length > 0 && FILLERS.has(words[0])) words.shift();
  return words;
}

/** A time with no date is the next time it happens: today if it hasn't passed, or else tomorrow. */
function nextTimeOfDay(time: ClockTime, context: PhraseContext): Due {
  const today = { date: context.today, time };
  const passed = toInstant(today.date, time, context.timeZone) < context.now;
  return passed ? { date: addDays(context.today, 1), time } : today;
}

/** Reads text as a due date with an optional time. A date with no time is due any time that day. */
export function parseDue(input: string, context: ParseContext): ParseResult {
  const text = normalize(input);
  if (text === '') return fail('empty');
  const phraseContext: PhraseContext = {
    now: context.now,
    timeZone: context.timeZone,
    weekStart: context.weekStart ?? 0,
    today: dateIn(context.now, context.timeZone),
  };
  const found = extractTime(text);
  if (found === 'invalid') return fail('invalid-time');
  const words = contentWords(found ? found.rest : text);
  if (words.length === 0) return found ? { ok: true, due: nextTimeOfDay(found.time, phraseContext) } : fail('empty');
  const phrase = parsePhrase(words, phraseContext);
  if (phrase === null) return fail('unrecognized');
  if (phrase === 'invalid-date') return fail('invalid-date');
  return { ok: true, due: { date: phrase.date, time: phrase.time ?? found?.time ?? null } };
}

export interface FoundDue {
  due: Due;
  /** The text before the date phrase, such as the task's title. */
  title: string;
  /** The date phrase as typed. */
  phrase: string;
}

/**
 * Finds a date phrase at the end of a sentence, such as "Read chapter 5 by Friday 5 PM". Returns the due date and
 * the rest of the text as the title. It takes the longest phrase that reads as a date, and returns null if the
 * sentence doesn't end in one.
 */
export function findDue(text: string, context: ParseContext): FoundDue | null {
  const words = text.trim().split(/\s+/);
  for (let start = 0; start < words.length; start += 1) {
    const phrase = words.slice(start).join(' ');
    const result = parseDue(phrase, context);
    if (result.ok) return { due: result.due, title: words.slice(0, start).join(' '), phrase };
  }
  return null;
}
