// "Remove" for the Markdown export (text DESIGN.md 9.3): the text keeps its Markdown and the marks of version 1, and
// the tags of version 2 that Markdown cannot hold are taken out, with their closing tags. A tag that has no partner
// stays as text, the same as the reader leaves it (R-INL-5), so nothing is lost but formatting.

import { closingName, readOpenTag } from '../../../../editor/markdown/tags';
import type { TagMark } from '../../../../editor/markdown/tags';
import { HIGHLIGHTER_COLORS, PEN_COLORS } from '../../../../editor/schema/constants';

/** The longest opening tag of the grammar, so a stray `<` costs a bounded scan. */
const MAX_TAG = 1900;

/** Whether a mark is one of version 1 (SPEC 7.4), which every reader of version 1 shows. */
function isVersion1(mark: TagMark): boolean {
  const attrs = mark.attrs;
  switch (mark.type) {
    case 'bold':
    case 'italic':
    case 'subscript':
    case 'superscript':
      return true;
    case 'underline':
      return attrs.line === undefined && attrs.color === undefined;
    case 'strike':
      return attrs.line === undefined;
    case 'highlight':
      return attrs.color == null || (HIGHLIGHTER_COLORS as readonly string[]).includes(attrs.color);
    case 'textColor': {
      const color = attrs.color ?? '';
      return (PEN_COLORS as readonly string[]).includes(color) || /^#[0-9a-f]{6}$/.test(color);
    }
    case 'textSize':
      return ['small', 'large', 'xlarge'].includes(attrs.size ?? '');
    default:
      return false;
  }
}

type Piece =
  | { readonly text: string }
  | { readonly open: string; readonly name: string; readonly keep: boolean; readonly drop: boolean; closed: boolean }
  | { readonly close: string; readonly name: string };

/** Skips a code span starting at `at` (a backtick), and returns its end, or `at + run` when it has no closing run. */
function codeSpanEnd(text: string, at: number): number {
  let n = 0;
  while (text[at + n] === '`') n += 1;
  let from = at + n;
  for (;;) {
    const next = text.indexOf('`', from);
    if (next < 0) return at + n;
    let run = 0;
    while (text[next + run] === '`') run += 1;
    if (run === n) return next + run;
    from = next + run;
  }
}

/** The reader keeps a tag that would nest deeper than this as text. */
const MAX_DEPTH = 32;

/** The length of the run of `ch` that ends `text` (or starts it, when `atEnd` is false). */
function runLength(text: string, ch: string, atEnd: boolean): number {
  let n = 0;
  while (n < text.length && text[atEnd ? text.length - 1 - n : n] === ch) n += 1;
  return n;
}

/**
 * `left` and `right` were apart by a tag that is now gone. Text that would join into a new construct is kept apart.
 * Two equal runs of a delimiter (backtick, *, _, ~) that close one span and open the next become one span, which reads
 * the same, because `a` and `b` side by side are one code span with the text ab. A `<` that would join a name into a
 * tag is escaped.
 */
function joinAcrossGap(left: string, right: string): string {
  const last = left.at(-1) ?? '';
  if (last === '<' && left.at(-2) !== '\\' && /^[A-Za-z/]/.test(right)) return `${left.slice(0, -1)}\\<${right}`;
  if ('`*_~'.includes(last) && right[0] === last) {
    const n = runLength(left, last, true);
    const m = runLength(right, last, false);
    const before = left[left.length - n - 1];
    const after = right[m];
    const spaced = (c: string | undefined) => c === undefined || /\s/.test(c);
    if (n === m && !spaced(before) && before !== '\\' && !spaced(after)) {
      return left.slice(0, left.length - n) + right.slice(m);
    }
  }
  return left + right;
}

/** The text of one inline unit without the tags of version 2 that Markdown cannot hold. */
function stripUnit(markdown: string): string {
  if (!markdown.includes('<')) return markdown;
  const pieces: Piece[] = [];
  const open: number[] = [];
  let plain = '';
  const flush = () => {
    if (plain !== '') pieces.push({ text: plain });
    plain = '';
  };
  let i = 0;
  while (i < markdown.length) {
    const c = markdown[i];
    if (c === '\\') {
      plain += markdown.slice(i, i + 2);
      i += 2;
    } else if (c === '`') {
      const end = codeSpanEnd(markdown, i);
      plain += markdown.slice(i, end);
      i = end;
    } else if (c === '<') {
      const rest = markdown.slice(i, i + MAX_TAG);
      const end = rest.indexOf('>');
      const raw = end < 0 ? '' : rest.slice(0, end + 1);
      const tag = raw === '' ? null : readOpenTag(raw);
      const closing = tag || raw === '' ? null : closingName(raw);
      if (tag && open.length >= MAX_DEPTH) {
        plain += raw;
        i += raw.length;
      } else if (tag) {
        flush();
        open.push(pieces.length);
        const drop = tag.mark.type === 'deletion';
        pieces.push({ open: raw, name: tag.name, keep: isVersion1(tag.mark), drop, closed: false });
        i += raw.length;
      } else if (closing !== null) {
        flush();
        const top = open.at(-1);
        const piece = top === undefined ? undefined : pieces[top];
        if (piece && 'open' in piece && piece.name === closing) {
          piece.closed = true;
          open.pop();
        }
        pieces.push({ close: raw, name: closing });
        i += raw.length;
      } else {
        plain += c;
        i += 1;
      }
    } else {
      plain += c;
      i += 1;
    }
  }
  flush();
  // A closing tag was paired when the open tag before it, in a stack, was closed by it: mark it by walking again.
  // Text inside a deleted run is gone, so it does not read as if it were still there.
  const stack: Extract<Piece, { open: string }>[] = [];
  let dropping = 0;
  let out = '';
  // Set when a tag was taken out, so the text on both sides of it can no longer join into something new.
  let gap = false;
  const emit = (text: string) => {
    if (text === '') return;
    out = gap ? joinAcrossGap(out, text) : out + text;
    gap = false;
  };
  for (const piece of pieces) {
    if ('text' in piece) {
      if (dropping === 0) emit(piece.text);
    } else if ('open' in piece) {
      if (piece.closed && piece.drop) {
        dropping += 1;
        gap = true;
      } else if (dropping === 0) {
        if (piece.closed && !piece.keep) gap = true;
        else emit(piece.open);
      }
      stack.push(piece);
    } else {
      const top = stack.at(-1);
      if (top && top.closed && top.name === piece.name) {
        stack.pop();
        if (top.drop) {
          dropping -= 1;
          gap = true;
        } else if (dropping === 0) {
          if (top.keep) emit(piece.close);
          else gap = true;
        }
      } else if (dropping === 0) emit(piece.close);
    }
  }
  return out;
}

const UNIT_START = /^\s*(?:#{1,6}\s|[-*+]\s|\d{1,9}[.)]\s|>|\|)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const INDENTED = /^(?: {4}|\t)/;
const ITEM = /^(?:[-*+]|\d{1,9}[.)])\s/;

/**
 * The Markdown without the formatting that only version 2 tags hold. Each paragraph, heading, list item, quote line,
 * and table row is read alone, as the reader reads it, so a tag never pairs across them. Code (fenced or indented)
 * and math blocks keep their text exactly. Escapes and code spans are left alone.
 */
export function removeFormatting(markdown: string): string {
  if (!markdown.includes('<')) return markdown;
  const out: string[] = [];
  let unit: string[] = [];
  const flush = () => {
    if (unit.length > 0) out.push(...stripUnit(unit.join('\n')).split('\n'));
    unit = [];
  };
  let fence: { readonly char: string; readonly size: number } | null = null;
  let math = false;
  let previousBlank = true;
  let inList = false;
  for (const line of markdown.split('\n')) {
    const blank = line.trim() === '';
    const fenced = FENCE.exec(line);
    if (fence) {
      out.push(line);
      if (fenced && fenced[1][0] === fence.char && fenced[1].length >= fence.size && line.trim() === fenced[1]) {
        fence = null;
      }
      previousBlank = false;
    } else if (math) {
      out.push(line);
      if (line.trim().endsWith('$$')) math = false;
      previousBlank = false;
    } else if (fenced) {
      flush();
      out.push(line);
      fence = { char: fenced[1][0], size: fenced[1].length };
      previousBlank = false;
    } else if (line.trim().startsWith('$$')) {
      flush();
      out.push(line);
      math = !line.trim().slice(2).includes('$$');
      previousBlank = false;
    } else if (blank) {
      flush();
      out.push(line);
      previousBlank = true;
    } else if (INDENTED.test(line) && previousBlank && !inList) {
      // An indented code block: it starts after a blank line, outside a list.
      flush();
      out.push(line);
      previousBlank = false;
    } else {
      if (UNIT_START.test(line)) flush();
      if (!/^\s/.test(line)) inList = ITEM.test(line);
      unit.push(line);
      previousBlank = false;
    }
  }
  flush();
  return out.join('\n');
}
