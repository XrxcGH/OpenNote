// Due dates written on a page (Productivity and study tools): a checkbox line such as "- [ ] Read chapter 4 by
// Friday" and a line tagged #todo, #task, #due, or #deadline. The date phrase at the end of the line is read with
// the same parser as the Upcoming box, shown beside the line, and fed to Upcoming.
import { dateKey, minutesOf } from './date';
import type { Due } from './date';
import type { Repeat } from './group';
import { findDue } from './parseDue';
import { parseRepeat } from './repeatPhrases';
import { FILLERS } from './words';
import type { ParseContext } from './parseDue';

export interface PageDue {
  block: string;
  /** The line's number in the block's Markdown, from 0. */
  line: number;
  /** What the line says, without its list marker, checkbox, tag, and date phrase. */
  title: string;
  due: Due;
  done: boolean;
  /** The date phrase as typed in the line. */
  phrase: string;
  /** Whether the line has a checkbox, which Upcoming can check off in the page. */
  task: boolean;
  /** How often the line repeats, when it says so ("every week"). */
  repeat?: Repeat;
}

const TASK = /^\s*(?:[-*+]|\d+[.)])\s+\[( |x|X)\]\s+(.*)$/;
const TAG = /(^|\s)#(?:todo|task|due|deadline)\b/gi;
const MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/;

/** What a line holds that Upcoming reads: its text and whether a checkbox is checked, or null for a plain line. */
export function dueCandidate(line: string): { text: string; done: boolean } | null {
  const task = TASK.exec(line);
  if (task) return { text: task[2].replace(TAG, '$1').trim(), done: task[1] !== ' ' };
  if (TAG.test(line)) {
    TAG.lastIndex = 0;
    return { text: line.replace(MARKER, '').replace(TAG, '$1').trim(), done: false };
  }
  TAG.lastIndex = 0;
  return null;
}

/** The due dates in the text blocks of a page. */
export function findPageDues(blocks: readonly { id: string; markdown: string }[], context: ParseContext): PageDue[] {
  const found: PageDue[] = [];
  for (const block of blocks) {
    block.markdown.split('\n').forEach((line, index) => {
      const candidate = dueCandidate(line);
      if (!candidate || candidate.text === '') return;
      const repeat = parseRepeat(candidate.text);
      const due = findDue(repeat ? repeat.rest : candidate.text, context);
      if (!due) return;
      found.push({
        block: block.id,
        line: index,
        title: due.title || candidate.text,
        due: due.due,
        done: candidate.done,
        phrase: datePart(due.phrase),
        task: TASK.test(line),
        ...(repeat ? { repeat: repeat.repeat } : {}),
      });
    });
  }
  return found;
}

/** The date words of a phrase, without the words before it such as "by" or "due", which stay in the line. */
export function datePart(phrase: string): string {
  const words = phrase.split(' ');
  let skip = 0;
  while (skip < words.length - 1 && FILLERS.has(words[skip].toLowerCase())) skip += 1;
  return words.slice(skip).join(' ');
}

/** A date and time written so the parser reads it back: "2026-10-07" or "2026-10-07 5:00 pm". */
export function formatDue(due: Due): string {
  if (!due.time) return dateKey(due.date);
  const minutes = minutesOf(due.time);
  const hour = Math.floor(minutes / 60);
  const clock = `${hour % 12 === 0 ? 12 : hour % 12}:${String(minutes % 60).padStart(2, '0')} ${hour < 12 ? 'am' : 'pm'}`;
  return `${dateKey(due.date)} ${clock}`;
}

/** The line with its date phrase replaced by a new due date, or null if the phrase is not in the line. */
export function withDue(line: string, phrase: string, due: Due): string | null {
  const at = line.lastIndexOf(phrase);
  return at === -1 ? null : `${line.slice(0, at)}${formatDue(due)}${line.slice(at + phrase.length)}`;
}
