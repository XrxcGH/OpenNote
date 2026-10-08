// The next copy of a repeating to-do line (Productivity and study tools). When "Water plants every week" is checked
// off, the next line is the same words with its date moved on. The text of a line is changed only where its date
// words were, or gets the date added at its end when it had none, so everything else in the line stays as typed.
import type { Repeat } from './group';
import { findDue } from './parseDue';
import { datePart, formatDue } from './pageDue';
import { nextDue } from './productivity';
import { parseRepeat } from './repeatPhrases';
import { dateIn } from './zone';

export interface LineEdit {
  /** The range of the line's text to replace: the date words, or the end of the line when there were none. */
  from: number;
  to: number;
  text: string;
}

export interface NextLine {
  repeat: Repeat;
  edit: LineEdit;
}

/**
 * What to change in the text of a to-do line to make its next copy, or null when the line does not say how often it
 * repeats. `text` is the line without its list marker and checkbox.
 */
export function nextLineEdit(text: string, now: number, timeZone: string): NextLine | null {
  const parsed = parseRepeat(text);
  if (!parsed) return null;
  const found = findDue(parsed.rest, { now, timeZone });
  const phrase = found ? datePart(found.phrase) : '';
  const at = phrase ? text.lastIndexOf(phrase) : -1;
  // A monthly line keeps the day of the month it was written for, so a short month does not move it for good.
  const repeat =
    found && parsed.repeat.unit === 'month' && parsed.repeat.dayOfMonth === undefined
      ? { ...parsed.repeat, dayOfMonth: found.due.date.day }
      : parsed.repeat;
  const followed = nextDue(repeat, found?.due ?? null, dateIn(now, timeZone));
  const written = formatDue(followed);
  return at >= 0
    ? { repeat, edit: { from: at, to: at + phrase.length, text: written } }
    : { repeat, edit: { from: text.length, to: text.length, text: ` ${written}` } };
}
