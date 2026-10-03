// The Markdown source view (FEATURES.md, Markdown source view): a typed page as one piece of Markdown. Each block
// starts at a marker comment such as `<!-- text a1b2 -->`. A text box's Markdown follows its marker; images, tables,
// ink, and other objects are only their marker, a placeholder that stays where it is. Reading the source back
// compares each text box with what it was and makes the smallest changes: it edits the boxes whose Markdown changed,
// adds a box for text written after a placeholder or under a new marker, and never deletes or moves a block.
import { newId } from '../../../editor/ids';

export interface SourceBlock {
  id: string;
  type: string;
  /** The Markdown of a text box; empty for any other block. */
  markdown: string;
  /** A short label for a placeholder, such as an image's description or a file's name. */
  label: string;
}

const MARKER = /^<!--\s*([a-z][a-z0-9]*)\s+([A-Za-z0-9_-]+)(?:\s+"([^"]*)")?\s*-->\s*$/;

/** The marker line of a block. */
export function markerOf(block: Pick<SourceBlock, 'id' | 'type' | 'label'>): string {
  const label = block.label
    .replace(/["\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `<!-- ${block.type} ${block.id}${label ? ` "${label}"` : ''} -->`;
}

/** The marker kind and ID on a line, or null. */
export function parseMarker(line: string): { kind: string; id: string; label: string } | null {
  const found = MARKER.exec(line.trim());
  return found ? { kind: found[1], id: found[2], label: found[3] ?? '' } : null;
}

export interface BuiltSource {
  source: string;
  /** The line (from 0) where each block's marker is. */
  lines: ReadonlyMap<string, number>;
}

/** The source of a page: its blocks in reading order, each after its marker, with a blank line between. */
export function buildSource(blocks: readonly SourceBlock[]): BuiltSource {
  const out: string[] = [];
  const lines = new Map<string, number>();
  for (const block of blocks) {
    if (out.length > 0) out.push('');
    lines.set(block.id, out.length);
    out.push(markerOf(block));
    if (block.type === 'text' && block.markdown.trim() !== '')
      out.push(...block.markdown.replace(/\s+$/, '').split('\n'));
  }
  return { source: out.join('\n'), lines };
}

export interface Segment {
  marker: { kind: string; id: string; label: string } | null;
  /** The Markdown after the marker, without blank lines at either end. */
  content: string;
  /** The line (from 0) of the marker, or of the first line when there is none. */
  line: number;
}

/** The source cut at its marker lines. */
export function parseSegments(source: string): Segment[] {
  const segments: Segment[] = [];
  let current: { marker: Segment['marker']; lines: string[]; line: number } = { marker: null, lines: [], line: 0 };
  const finish = () => {
    segments.push({
      marker: current.marker,
      content: current.lines.join('\n').replace(/^\n+|\n+$/g, ''),
      line: current.line,
    });
  };
  source.split('\n').forEach((raw, index) => {
    const line = raw.replace(/\r$/, '');
    const marker = parseMarker(line);
    if (marker) {
      finish();
      current = { marker, lines: [], line: index };
    } else {
      current.lines.push(line);
    }
  });
  finish();
  return segments.filter((segment) => segment.marker !== null || segment.content !== '');
}

export type SourceEdit =
  | { kind: 'setText'; block: string; markdown: string }
  | { kind: 'insert'; id: string; markdown: string; after: string | null; before: string | null };

const sameText = (a: string, b: string) => a.replace(/\s+$/, '') === b.replace(/\s+$/, '');

/** What reading the source back changes in a page whose blocks are `blocks`. */
export function planSource(source: string, blocks: readonly SourceBlock[]): SourceEdit[] {
  const known = new Map(blocks.map((block) => [block.id, block]));
  const edits: SourceEdit[] = [];
  const first = blocks[0]?.id ?? null;
  // The block the next new box goes after: the last one the source mentioned, or one just added.
  let last: string | null = null;
  for (const segment of parseSegments(source)) {
    const block = segment.marker ? known.get(segment.marker.id) : undefined;
    if (block) {
      last = block.id;
      if (block.type === 'text') {
        if (!sameText(segment.content, block.markdown)) {
          edits.push({ kind: 'setText', block: block.id, markdown: segment.content });
        }
      } else if (segment.content !== '') {
        // Text written under a placeholder is a new box right after it.
        const id = newId();
        edits.push({ kind: 'insert', id, markdown: segment.content, after: block.id, before: null });
        last = id;
      }
      continue;
    }
    // A marker nobody knows, or text before the first marker: a new text box after the one before.
    if (segment.content === '') continue;
    const id = newId();
    edits.push({ kind: 'insert', id, markdown: segment.content, after: last, before: last === null ? first : null });
    last = id;
  }
  return edits;
}

export type TokenKind =
  'text' | 'heading' | 'marker' | 'quote' | 'strong' | 'emphasis' | 'code' | 'link' | 'placeholder';

export interface Token {
  text: string;
  kind: TokenKind;
}

const INLINE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\[[^\]\n]*\]\([^)\n]*\)|\*[^*\s][^*\n]*\*|_[^_\s][^_\n]*_)/g;

function inline(text: string): Token[] {
  const out: Token[] = [];
  let at = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > at) out.push({ text: text.slice(at, match.index), kind: 'text' });
    const piece = match[0];
    const kind: TokenKind = piece.startsWith('`')
      ? 'code'
      : piece.startsWith('[')
        ? 'link'
        : piece.startsWith('**') || piece.startsWith('__')
          ? 'strong'
          : 'emphasis';
    out.push({ text: piece, kind });
    at = match.index + piece.length;
  }
  if (at < text.length) out.push({ text: text.slice(at), kind: 'text' });
  return out;
}

/** One line of source as coloured pieces, which together are exactly the line. */
export function tokenizeLine(line: string): Token[] {
  if (parseMarker(line)) return [{ text: line, kind: 'placeholder' }];
  const heading = /^(#{1,6}\s)(.*)$/.exec(line);
  if (heading)
    return [
      { text: heading[1], kind: 'marker' },
      { text: heading[2], kind: 'heading' },
    ];
  const lead = /^(\s*(?:>\s?)+)(.*)$/.exec(line);
  if (lead) return [{ text: lead[1], kind: 'quote' }, ...inline(lead[2])];
  const list = /^(\s*(?:[-*+]|\d+[.)])\s(?:\[[ xX]\]\s)?)(.*)$/.exec(line);
  if (list) return [{ text: list[1], kind: 'marker' }, ...inline(list[2])];
  return line === '' ? [] : inline(line);
}

/** The text of a line without its leading syntax, and how many characters that syntax took. */
export function stripSyntax(line: string): { text: string; prefix: number } {
  const lead = /^(\s*(?:#{1,6}\s|(?:>\s?)+|(?:[-*+]|\d+[.)])\s(?:\[[ xX]\]\s)?))/.exec(line);
  const prefix = lead ? lead[1].length : 0;
  return { text: line.slice(prefix), prefix };
}

/**
 * The place in the source for a caret in a text box: the line of the box whose words match the paragraph the caret
 * is in, and the column in it. Falls back to the box's marker line.
 */
export function sourceCaret(
  source: string,
  markerLine: number,
  paragraph: string,
  offset: number,
): { line: number; column: number } {
  const lines = source.split('\n');
  const wanted = paragraph.trim();
  if (wanted !== '') {
    for (let index = markerLine + 1; index < lines.length; index += 1) {
      if (parseMarker(lines[index])) break;
      const { text, prefix } = stripSyntax(lines[index]);
      if (text.trim() !== '' && text.includes(wanted.slice(0, 30))) {
        return { line: index, column: Math.min(lines[index].length, prefix + offset) };
      }
    }
  }
  return { line: Math.min(markerLine + 1, lines.length - 1), column: 0 };
}

/** Which block and paragraph a caret at a place in the source is in: the nearest marker above, and the line's words. */
export function caretTarget(
  source: string,
  line: number,
  column: number,
): { block: string; paragraph: string; offset: number } | null {
  const lines = source.split('\n');
  for (let index = Math.min(line, lines.length - 1); index >= 0; index -= 1) {
    const marker = parseMarker(lines[index]);
    if (!marker) continue;
    const { text, prefix } = stripSyntax(lines[line] ?? '');
    return { block: marker.id, paragraph: index === line ? '' : text.trim(), offset: Math.max(0, column - prefix) };
  }
  return null;
}
