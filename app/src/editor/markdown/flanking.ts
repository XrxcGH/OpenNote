// CommonMark's flanking rules, with the character classes that markdown-it uses. The writer and the reader then
// agree on which delimiters open and close. SPEC 7.7 writes an HTML tag where a delimiter would not work.
import MarkdownIt from 'markdown-it';

const { isWhiteSpace, isPunctChar, isMdAsciiPunct } = new MarkdownIt().utils;

export type CharClass = 'ws' | 'punct' | 'other';

/** The class of one character. The start or end of a line, and a line break, count as whitespace. */
export function classOf(ch: string | undefined): CharClass {
  if (ch === undefined || ch === '\n') return 'ws';
  const code = ch.codePointAt(0) as number;
  if (isWhiteSpace(code)) return 'ws';
  return isMdAsciiPunct(code) || isPunctChar(ch) ? 'punct' : 'other';
}

/** Whether `ch` is whitespace in the sense of SPEC 7.7's "moved outside the delimiters". */
export function isSpaceChar(ch: string | undefined): boolean {
  return classOf(ch) === 'ws';
}

/** The class of the first or last character of an output string. */
export function edgeClass(text: string, side: 'first' | 'last'): CharClass {
  if (text === '') return 'ws';
  const chars = Array.from(text);
  return classOf(side === 'first' ? chars[0] : chars[chars.length - 1]);
}

/** A `*` or `~~` run opens when it is left-flanking. */
export function canOpen(prev: CharClass, next: CharClass): boolean {
  return next !== 'ws' && (next !== 'punct' || prev !== 'other');
}

/** A `*` or `~~` run closes when it is right-flanking. */
export function canClose(prev: CharClass, next: CharClass): boolean {
  return prev !== 'ws' && (prev !== 'punct' || next !== 'other');
}

/** SPEC 7.3: `==` opens when the next character is not whitespace and closes when the previous one is not. */
export function canOpenHighlight(_prev: CharClass, next: CharClass): boolean {
  return next !== 'ws';
}

export function canCloseHighlight(prev: CharClass, _next: CharClass): boolean {
  return prev !== 'ws';
}
