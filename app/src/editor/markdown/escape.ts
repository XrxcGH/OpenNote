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
  /** Where the line's text starts in `chars`. */
  readonly lineStart: number;
  /** False when other markup comes before `lineStart` on the same line, so the line-start rules don't apply. */
  readonly opens: boolean;
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

function escapeEquals({ chars, at, lineStart, opens, mode, seams }: Position): string {
  const touching = (at > lineStart && chars[at - 1] === '=') || chars[at + 1] === '=';
  const first = mode.paragraphLine && opens && at === lineStart;
  const beside = seams.highlights.has(at) || seams.highlights.has(at + 1);
  return touching || first || beside ? '\\=' : '=';
}

function escapeSpace({ chars, at, lineStart, opens, mode }: Position): string {
  const last = at + 1 >= chars.length || chars[at + 1] === '\n';
  return mode.spaceEdges && ((opens && at === lineStart) || last) ? '&#32;' : ' ';
}

function escapeAt(where: Position): string {
  const { chars, at, lineStart, opens, mode } = where;
  const ch = chars[at];
  const first = opens && at === lineStart;
  if (ALWAYS.has(ch)) return `\\${ch}`;
  if (ch === '\t') return '&#9;';
  if (ch === ' ') return escapeSpace(where);
  if (ch === '_') return escapeUnderscore(where);
  if (ch === '=') return escapeEquals(where);
  if (ch === '&') return CHARACTER_REFERENCE.test(chars.slice(at, at + 40).join('')) ? '\\&' : '&';
  if (ch === '#') return at === lineStart || isSpaceChar(chars[at - 1]) ? '\\#' : '#';
  if (LINE_START_ONLY.has(ch)) return mode.paragraphLine && first ? `\\${ch}` : ch;
  const numbered = mode.paragraphLine && where.opens && isDigits(chars, lineStart, at);
  if ((ch === '.' || ch === ')') && numbered) return `\\${ch}`;
  return ch;
}

/**
 * What each code point is written as. A newline ends a line, and the next line opens. `opensLine` is false when the
 * first code point follows other markup on its line.
 */
export function escapeCodePoints(
  chars: readonly string[],
  mode: EscapeMode,
  seams: Seams = NO_SEAMS,
  opensLine = true,
): string[] {
  const out: string[] = [];
  let lineStart = 0;
  let opens = opensLine;
  for (let at = 0; at < chars.length; at++) {
    if (at > 0 && chars[at - 1] === '\n') [lineStart, opens] = [at, true];
    out.push(chars[at] === '\n' ? '\n' : escapeAt({ chars, at, lineStart, opens, mode, seams }));
  }
  return out;
}

/**
 * SPEC 7.6 for paragraph text, as the shared escape fixtures pair them: a line break becomes a hard break, and
 * `atLineStart` says whether the text starts a paragraph line or follows other markup on it.
 */
export function escapeParagraphText(text: string, atLineStart = true): string {
  const escaped = escapeCodePoints(Array.from(cleanText(text)), PARAGRAPH, NO_SEAMS, atLineStart);
  return escaped.map((written) => (written === '\n' ? '\\\n' : written)).join('');
}

/** Replaces `U+0000`, lone surrogates, and `U+000D`, which Markdown text never holds (SPEC 7.6 and 7.7). */
export function cleanText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\0/g, '\ufffd').replace(LONE_SURROGATE, '\ufffd');
}
