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
  | { readonly open: string; readonly name: string; readonly keep: boolean; closed: boolean }
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

/** The Markdown without the formatting that only version 2 tags hold. Escapes and code spans are left alone. */
export function removeFormatting(markdown: string): string {
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
      if (tag) {
        flush();
        open.push(pieces.length);
        pieces.push({ open: raw, name: tag.name, keep: isVersion1(tag.mark), closed: false });
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
  const stack: Extract<Piece, { open: string }>[] = [];
  let out = '';
  for (const piece of pieces) {
    if ('text' in piece) out += piece.text;
    else if ('open' in piece) {
      out += piece.closed && !piece.keep ? '' : piece.open;
      stack.push(piece);
    } else {
      const top = stack.at(-1);
      if (top && top.closed && top.name === piece.name) {
        stack.pop();
        out += top.keep ? piece.close : '';
      } else out += piece.close;
    }
  }
  return out;
}
