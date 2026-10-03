// Block OpenNote Markdown (format spec 7.2) to the neutral tree: paragraphs, headings, lists with tasks, block quotes,
// callouts, fenced code, and thematic breaks. It reads canonical text exactly, and hand-written CommonMark in the
// usual forms: setext headings, indented code, lazy continuation lines, and any bullet or number marker. Raw HTML
// blocks, link reference definitions, and footnotes are not supported and read as paragraphs.

import { parseInline } from './inline';
import type { Block, Document, ListItem } from './tree';

const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>(.*)$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const CALLOUT = /^\[!([A-Za-z0-9_-]+)\]([+-])?(?:[ \t]+(.*))?$/;
const LANGUAGE = /^[A-Za-z0-9_+#.-]{1,32}$/;

const isBlank = (line: string): boolean => line.trim() === '';
const indentOf = (line: string): number => line.length - line.trimStart().length;

/** Replaces tabs in a line's leading whitespace, and one after a list marker, with spaces to the next multiple of 4. */
function expandTabs(line: string): string {
  const lead = /^[ \t]+/.exec(line);
  let text = line;
  if (lead?.[0].includes('\t')) {
    let col = 0;
    for (const ch of lead[0]) col = ch === '\t' ? col + 4 - (col % 4) : col + 1;
    text = ' '.repeat(col) + line.slice(lead[0].length);
  }
  const marked = /^( *(?:[-+*]|\d{1,9}[.)]))\t/.exec(text);
  if (!marked) return text;
  return marked[1] + ' '.repeat(4 - (marked[1].length % 4)) + text.slice(marked[0].length);
}

interface Marker {
  readonly ordered: boolean;
  /** The bullet character, or the closing delimiter of a number. */
  readonly kind: string;
  readonly number: number;
  /** The column where the item's content starts. Later lines belong to the item when indented at least this far. */
  readonly width: number;
  /** The text after the marker on the first line. */
  readonly rest: string;
}

function markerOf(line: string): Marker | null {
  const bullet = /^( {0,3})([-+*])( *)(.*)$/.exec(line);
  const number = /^( {0,3})(\d{1,9})([.)])( *)(.*)$/.exec(line);
  const m = bullet ?? number;
  if (!m || (bullet && bullet[3] === '' && bullet[4] !== '')) return null;
  if (number && !bullet && number[4] === '' && number[5] !== '') return null;
  const indent = m[1].length;
  const markerWidth = bullet ? 1 : number![2].length + 1;
  const spaces = (bullet ? bullet[3] : number![4]).length;
  const rest = bullet ? bullet[4] : number![5];
  const empty = rest.trim() === '';
  const wide = spaces >= 5 || empty;
  return {
    ordered: !bullet,
    kind: bullet ? bullet[2] : number![3],
    number: bullet ? 0 : Number(number![2]),
    width: indent + markerWidth + (wide ? 1 : spaces),
    rest: wide && !empty ? ' '.repeat(spaces - 1) + rest : rest,
  };
}

const sameList = (a: Marker, b: Marker): boolean => a.ordered === b.ordered && a.kind === b.kind;

/** True when the line starts a block that may interrupt a paragraph. */
function interrupts(line: string): boolean {
  if (FENCE.test(line) || /^ {0,3}#{1,6}([ \t]|$)/.test(line) || HR.test(line) || QUOTE.test(line)) return true;
  if (line.trim() === '$$') return true;
  const m = markerOf(line);
  return m !== null && m.rest.trim() !== '' && (!m.ordered || m.number === 1);
}

/** True when a line without the container's prefix still continues the paragraph above it. */
function lazyAfter(previous: string | undefined, line: string): boolean {
  if (previous === undefined || isBlank(previous) || isBlank(line) || interrupts(line)) return false;
  return !(FENCE.test(previous) || HR.test(previous) || /^ {0,3}#{1,6}([ \t]|$)/.test(previous));
}

function fenceBlock(lines: readonly string[], start: number, out: Block[]): number | null {
  const m = FENCE.exec(lines[start]);
  if (!m) return null;
  const [, lead, fence, rawInfo] = m;
  const info = rawInfo.trim();
  if (fence[0] === '`' && info.includes('`')) return null;
  const word = unescapeInfo(info.split(/\s+/)[0] ?? '');
  const close = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*$`);
  const body: string[] = [];
  let i = start + 1;
  while (i < lines.length && !close.test(lines[i])) {
    const strip = Math.min(lead.length, indentOf(lines[i]));
    body.push(lines[i].slice(strip));
    i += 1;
  }
  out.push({ type: 'code', language: LANGUAGE.test(word) ? word : '', text: body.join('\n') });
  return Math.min(i + 1, lines.length);
}

const unescapeInfo = (info: string): string => info.replace(/\\(.)/g, '$1');

function mathBlock(lines: readonly string[], start: number, out: Block[]): number {
  const body: string[] = [];
  let i = start + 1;
  while (i < lines.length && lines[i].trim() !== '$$') body.push(lines[i++]);
  out.push({ type: 'math', source: body.join('\n') });
  return Math.min(i + 1, lines.length);
}

function quoteBlock(lines: readonly string[], start: number, out: Block[]): number {
  const inner: string[] = [];
  let i = start;
  while (i < lines.length) {
    const m = QUOTE.exec(lines[i]);
    if (m) inner.push(m[1].startsWith(' ') ? m[1].slice(1) : m[1]);
    else if (lazyAfter(inner.at(-1), lines[i])) inner.push(lines[i].trimStart());
    else break;
    i += 1;
  }
  const callout = CALLOUT.exec(inner[0] ?? '');
  if (callout) {
    const title = (callout[3] ?? '').trim();
    out.push({
      type: 'callout',
      callout: callout[1].toLowerCase(),
      fold: callout[2] === '-' ? 'folded' : callout[2] === '+' ? 'open' : null,
      title: title === '' ? [] : parseInline(title),
      blocks: parseBlocks(inner.slice(1)),
    });
  } else out.push({ type: 'quote', blocks: parseBlocks(inner) });
  return i;
}

/** The lines of one list item, with its content column removed, and the position after it. */
function itemLines(lines: readonly string[], start: number, m: Marker): { body: string[]; next: number } {
  const body = [m.rest];
  let i = start + 1;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      let j = i;
      while (j < lines.length && isBlank(lines[j])) j += 1;
      if (j >= lines.length || indentOf(lines[j]) < m.width) break;
      for (; i < j; i += 1) body.push('');
    } else if (indentOf(line) >= m.width) {
      body.push(line.slice(m.width));
      i += 1;
    } else if (lazyAfter(body.at(-1), line) && markerOf(line) === null) {
      body.push(line.trimStart());
      i += 1;
    } else break;
  }
  return { body, next: i };
}

function taskOf(first: string): { task: ListItem['task']; rest: string } {
  const m = /^\[([ xX])\](?:[ \t]+|$)/.exec(first);
  if (!m) return { task: null, rest: first };
  return { task: m[1] === ' ' ? 'open' : 'done', rest: first.slice(m[0].length) };
}

function listBlock(lines: readonly string[], start: number, first: Marker, out: Block[]): number {
  const items: ListItem[] = [];
  let i = start;
  let m: Marker | null = first;
  while (m && sameList(m, first)) {
    const { body, next } = itemLines(lines, i, m);
    const { task, rest } = taskOf(body[0]);
    items.push({ task, blocks: parseBlocks([rest, ...body.slice(1)]) });
    i = next;
    let j = i;
    while (j < lines.length && isBlank(lines[j])) j += 1;
    m = j < lines.length && !HR.test(lines[j]) ? markerOf(lines[j]) : null;
    if (m) i = j;
  }
  out.push(
    first.ordered
      ? { type: 'list', ordered: true, start: first.number, items }
      : { type: 'list', ordered: false, items },
  );
  return i;
}

function paragraph(lines: readonly string[], start: number, out: Block[]): number {
  const buf = [lines[start].trimStart()];
  let i = start + 1;
  while (i < lines.length && !isBlank(lines[i])) {
    const setext = SETEXT.exec(lines[i]);
    if (setext) {
      const content = parseInline(buf.join('\n').trimEnd());
      out.push({ type: 'heading', level: setext[1][0] === '=' ? 1 : 2, content });
      return i + 1;
    }
    if (interrupts(lines[i])) break;
    buf.push(lines[i].trimStart());
    i += 1;
  }
  out.push({ type: 'paragraph', content: parseInline(buf.join('\n').trimEnd()) });
  return i;
}

function indentedCode(lines: readonly string[], start: number, out: Block[]): number {
  const body: string[] = [];
  let i = start;
  while (i < lines.length && (isBlank(lines[i]) || indentOf(lines[i]) >= 4)) body.push(lines[i++].slice(4));
  while (body.length > 0 && isBlank(body[body.length - 1])) body.pop();
  out.push({ type: 'code', language: '', text: body.join('\n') });
  return i;
}

function heading(line: string): Block | null {
  const m = /^ {0,3}(#{1,6})([ \t]+.*)?$/.exec(line);
  if (!m) return null;
  const text = (m[2] ?? '').trim().replace(/(^|[ \t]+)#+[ \t]*$/, '');
  return { type: 'heading', level: m[1].length, content: text === '' ? [] : parseInline(text.trim()) };
}

/** Parses lines that have had their container prefixes removed. */
export function parseBlocks(lines: readonly string[]): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const atx = isBlank(line) ? null : heading(line);
    const marker = HR.test(line) ? null : markerOf(line);
    if (isBlank(line)) i += 1;
    else if (line.trim() === '$$') i = mathBlock(lines, i, out);
    else if (atx) {
      out.push(atx);
      i += 1;
    } else if (HR.test(line)) {
      out.push({ type: 'break' });
      i += 1;
    } else if (QUOTE.test(line)) i = quoteBlock(lines, i, out);
    else if (marker) i = listBlock(lines, i, marker, out);
    else if (indentOf(line) >= 4) i = indentedCode(lines, i, out);
    else i = fenceBlock(lines, i, out) ?? paragraph(lines, i, out);
  }
  return out;
}

/** Parses the Markdown of one text block into the neutral document tree. */
export function parseMarkdown(markdown: string): Document {
  const lines = markdown.replace(/\r\n?/g, '\n').replace(/\0/g, '�').split('\n').map(expandTabs);
  return parseBlocks(lines);
}
