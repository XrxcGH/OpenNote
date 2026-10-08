// Checking off a to-do that lives on a page, from Upcoming (Productivity and study tools). The check is written to the
// page's own text, so the page and Upcoming always agree: the box in the line changes, and a line that repeats gets
// its next copy under it. The functions work on a block's Markdown and give back the new Markdown, or null when the
// line is not where Upcoming last saw it.
import { nextLineEdit } from './repeatLine';

const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s?)(.*)$/;
const indentOf = (line: string): number => /^\s*/.exec(line)?.[0].length ?? 0;

/** Whether line `index` of the Markdown is a checkbox item, and whether it is checked. */
export function boxAt(markdown: string, index: number): 'open' | 'done' | null {
  const match = TASK.exec(markdown.split('\n')[index] ?? '');
  return match ? (match[2] === ' ' ? 'open' : 'done') : null;
}

/** The Markdown with the checkbox on line `index` checked or unchecked, or null if that line has no checkbox. */
export function setBoxAt(markdown: string, index: number, done: boolean): string | null {
  const lines = markdown.split('\n');
  const match = TASK.exec(lines[index] ?? '');
  if (!match) return null;
  lines[index] = `${match[1]}${done ? 'x' : ' '}${match[3]}${match[4]}`;
  return lines.join('\n');
}

/**
 * The Markdown with the next copy of a repeating checkbox line added under it (and under any items nested in it), or
 * null when the line does not say how often it repeats.
 */
export function addNextLine(markdown: string, index: number, now: number, timeZone: string): string | null {
  const lines = markdown.split('\n');
  const match = TASK.exec(lines[index] ?? '');
  if (!match) return null;
  const next = nextLineEdit(match[4], now, timeZone);
  if (!next) return null;
  const text = `${match[4].slice(0, next.edit.from)}${next.edit.text}${match[4].slice(next.edit.to)}`;
  let after = index + 1;
  while (after < lines.length && lines[after].trim() !== '' && indentOf(lines[after]) > indentOf(lines[index]))
    after += 1;
  lines.splice(after, 0, `${match[1]} ${match[3]}${text}`);
  return lines.join('\n');
}

/** Checks the line off, and adds the next copy if it repeats. Null if the line has no checkbox to change. */
export function checkOffLine(markdown: string, index: number, now: number, timeZone: string): string | null {
  const checked = setBoxAt(markdown, index, true);
  if (checked === null) return null;
  return addNextLine(checked, index, now, timeZone) ?? checked;
}
