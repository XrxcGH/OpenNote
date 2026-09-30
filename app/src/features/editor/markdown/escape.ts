// SPEC 7.6: escaping text exactly as the table says, and nowhere else. The functions work on code points so that a
// caller can escape one line of text that spans several marks and still get the same answer as for plain text.
import { isSpaceChar } from './flanking';

export interface EscapeMode {
  /** True for a paragraph line: the `>`, `-`, `+`, `=`, and numbered-list rules apply at its start. */
  readonly paragraphLine: boolean;
  /** True when a space first or last on the line would be dropped by CommonMark, so it is written `&#32;`. */
  readonly spaceEdges: boolean;
}

export const PARAGRAPH: EscapeMode = { paragraphLine: true, spaceEdges: true };
/** Headings and callout titles: a line, but not a paragraph line. */
export const TITLE: EscapeMode = { paragraphLine: false, spaceEdges: true };
/** Image descriptions and other text inside brackets. */
export const LABEL: EscapeMode = { paragraphLine: false, spaceEdges: false };

/**
 * Places between two code points where markup is written. An index `i` means the markup sits just before code
 * point `i`. A `_` or `=` beside markup is judged by what is written there, not by the text around the markup.
 */
export interface Seams {
  /** Where a `==` delimiter sits. A literal `=` beside it would join it. */
  readonly highlights: ReadonlySet<number>;
  /** Where any mark starts or ends. A `_` beside it is no longer inside a word. */
  readonly marks: ReadonlySet<number>;
}

const NO_SEAMS: Seams = { highlights: new Set(), marks: new Set() };

const ALWAYS = new Set(['\\', '`', '*', '~', '$', '[', ']', '{', '<', '|']);
const LINE_START_ONLY = new Set(['>', '-', '+']);
const LETTER_OR_DIGIT = /^[\p{L}\p{N}]$/u;
const CHARACTER_REFERENCE = /^&#?[A-Za-z0-9]+;/;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

interface Position {
  readonly chars: readonly string[];
  readonly at: number;
  readonly lineStart: number;
  readonly mode: EscapeMode;
  readonly seams: Seams;
}

function isDigits(chars: readonly string[], from: number, to: number): boolean {
  const count = to - from;
  if (count < 1 || count > 9) return false;
  return chars.slice(from, to).every((ch) => ch >= '0' && ch <= '9');
}

function escapeUnderscore({ chars, at, lineStart, seams }: Position): string {
  const prev = at > lineStart ? chars[at - 1] : undefined;
  const next = chars[at + 1];
  const apart = seams.marks.has(at) || seams.marks.has(at + 1);
  const inWord = prev !== undefined && next !== undefined && LETTER_OR_DIGIT.test(prev) && LETTER_OR_DIGIT.test(next);
  return inWord && !apart ? '_' : '\\_';
}

function escapeEquals({ chars, at, lineStart, mode, seams }: Position): string {
  const touching = (at > lineStart && chars[at - 1] === '=') || chars[at + 1] === '=';
  const first = mode.paragraphLine && at === lineStart;
  const beside = seams.highlights.has(at) || seams.highlights.has(at + 1);
  return touching || first || beside ? '\\=' : '=';
}

function escapeSpace({ chars, at, lineStart, mode }: Position): string {
  const last = at + 1 >= chars.length || chars[at + 1] === '\n';
  return mode.spaceEdges && (at === lineStart || last) ? '&#32;' : ' ';
}

function escapeAt(where: Position): string {
  const { chars, at, lineStart, mode } = where;
  const ch = chars[at];
  const first = at === lineStart;
  if (ALWAYS.has(ch)) return `\\${ch}`;
  if (ch === '\t') return '&#9;';
  if (ch === ' ') return escapeSpace(where);
  if (ch === '_') return escapeUnderscore(where);
  if (ch === '=') return escapeEquals(where);
  if (ch === '&') return CHARACTER_REFERENCE.test(chars.slice(at, at + 40).join('')) ? '\\&' : '&';
  if (ch === '#') return first || isSpaceChar(chars[at - 1]) ? '\\#' : '#';
  if (LINE_START_ONLY.has(ch)) return mode.paragraphLine && first ? `\\${ch}` : ch;
  if ((ch === '.' || ch === ')') && mode.paragraphLine && isDigits(chars, lineStart, at)) return `\\${ch}`;
  return ch;
}

/** What each code point is written as. A newline ends a line. */
export function escapeCodePoints(chars: readonly string[], mode: EscapeMode, seams: Seams = NO_SEAMS): string[] {
  const out: string[] = [];
  let lineStart = 0;
  for (let at = 0; at < chars.length; at++) {
    if (at > 0 && chars[at - 1] === '\n') lineStart = at;
    out.push(chars[at] === '\n' ? '\n' : escapeAt({ chars, at, lineStart, mode, seams }));
  }
  return out;
}

/** SPEC 7.6 for text that starts a paragraph line. Used by the shared escape fixtures. */
export function escapeParagraphText(text: string): string {
  return escapeCodePoints(Array.from(text), PARAGRAPH).join('');
}

/** Replaces `U+0000`, lone surrogates, and `U+000D`, which Markdown text never holds (SPEC 7.6 and 7.7). */
export function cleanText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\0/g, '\ufffd').replace(LONE_SURROGATE, '\ufffd');
}
