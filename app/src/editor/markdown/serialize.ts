// A ProseMirror text block document to canonical OpenNote Markdown (SPEC 7.2 and 7.7). The same document always gives
// the same string, so saving, reloading, and undo give identical text. With a cache, every node the writer visits
// keeps its text (ARCHITECTURE.md section 9.2), so writing a document after a small change only writes what changed.
// Node types are compared by name, so documents from any schema instance work: editors build their own.
import type { Node as PMNode } from '@tiptap/pm/model';
import { CALLOUT_TYPE_PATTERN, FOLDS, LANGUAGE_PATTERN } from '../schema/specs';
import { stateOf } from './cache';
import type { CacheEntry, CacheState, MarkdownCache } from './cache';
import { PARAGRAPH, TITLE, cleanText } from './escape';
import { serializeInline } from './inline';
import { joinAdjacentLists } from './normalize';

type Store = CacheState | null;

const NO_SPANS = new Int32Array(0);

/** Markdown cannot hold an empty paragraph between blocks, so one is dropped. */
const isEmptyParagraph = (node: PMNode) => node.type.name === 'paragraph' && node.content.size === 0;
const isList = (node: PMNode) => node.type.name === 'bulletList' || node.type.name === 'orderedList';

function leaf(text: string): CacheEntry {
  return { ctx: '', text, inner: text, childStarts: NO_SPANS, childEnds: NO_SPANS, loose: false };
}

function fenceText(node: PMNode): string {
  const source = cleanText(node.textContent);
  const language = node.attrs.language as string | null;
  const runs = source.split('\n').map((line) => /^ {0,3}(`+)/.exec(line)?.[1].length ?? 0);
  const fence = '`'.repeat(Math.max(3, ...runs.map((run) => run + 1)));
  const info = language && LANGUAGE_PATTERN.test(language) ? language : '';
  return source === '' ? `${fence}${info}\n${fence}` : `${fence}${info}\n${source}\n${fence}`;
}

/** `> ` before every line, and `>` alone on a blank one. */
export function quoted(text: string): string {
  return text
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');
}

/** Every line after the first that holds text, indented by `width` spaces. */
export function indented(text: string, width: number): string {
  return text.replace(/\n(?=[^\n])/g, `\n${' '.repeat(width)}`);
}

function taskPrefix(checked: boolean | null): string {
  return checked === null ? '' : checked ? '[x] ' : '[ ] ';
}

/** The marker of item `index` in a list: `- `, or `10. ` for the tenth item of a numbered list starting at 1. */
export function markerOf(list: PMNode, index: number): string {
  if (list.type.name !== 'orderedList') return '- ';
  return `${Math.max(0, Math.floor(Number(list.attrs.start) || 0)) + index}. `;
}

interface Joined {
  readonly text: string;
  readonly starts: Int32Array | null;
  readonly ends: Int32Array | null;
}

function hasAdjacentLists(node: PMNode, from: number): boolean {
  for (let i = from + 1; i < node.childCount; i++) {
    const a = node.child(i - 1);
    if (isList(a) && a.type === node.child(i).type) return true;
  }
  return false;
}

/**
 * The blocks of `node` from child `from` on, joined by one blank line. Spans are relative to the joined text, one
 * for each child from `from` on.
 */
function joinBlocks(node: PMNode, from: number, store: Store): Joined {
  if (hasAdjacentLists(node, from)) {
    const children: PMNode[] = [];
    for (let i = from; i < node.childCount; i++) children.push(node.child(i));
    const parts = joinAdjacentLists(children)
      .filter((child) => !isEmptyParagraph(child))
      .map((child) => entryOf(child, '', store).text);
    return { text: parts.join('\n\n'), starts: null, ends: null };
  }
  const count = node.childCount - from;
  const starts = new Int32Array(count);
  const ends = new Int32Array(count);
  const parts: string[] = [];
  const waiting: number[] = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    const child = node.child(from + i);
    if (isEmptyParagraph(child)) {
      waiting.push(i);
      continue;
    }
    if (parts.length > 0) at += 2;
    for (const dropped of waiting) starts[dropped] = ends[dropped] = at;
    waiting.length = 0;
    const text = entryOf(child, '', store).text;
    starts[i] = at;
    at += text.length;
    ends[i] = at;
    parts.push(text);
  }
  for (const dropped of waiting) starts[dropped] = ends[dropped] = at;
  return { text: parts.join('\n\n'), starts, ends };
}

function shifted(spans: Int32Array | null, by: number, limit: number): Int32Array | null {
  return spans && spans.map((at) => Math.min(limit, at + by));
}

function withHead(head: Int32Array | null, rest: Int32Array | null, first: number): Int32Array | null {
  if (!head || !rest) return null;
  const out = new Int32Array(rest.length + 1);
  out[0] = first;
  out.set(rest, 1);
  return out;
}

function blocksEntry(node: PMNode, store: Store): CacheEntry {
  const joined = joinBlocks(node, 0, store);
  return {
    ctx: '',
    text: joined.text,
    inner: joined.text,
    childStarts: joined.starts,
    childEnds: joined.ends,
    loose: false,
  };
}

function quoteEntry(node: PMNode, store: Store): CacheEntry {
  const joined = joinBlocks(node, 0, store);
  return {
    ctx: '',
    text: quoted(joined.text),
    inner: joined.text,
    childStarts: joined.starts,
    childEnds: joined.ends,
    loose: false,
  };
}

/** Whether the first block a container writes from child `from` on is a paragraph. */
function writesParagraphFirst(node: PMNode, from: number): boolean {
  for (let i = from; i < node.childCount; i++) {
    const child = node.child(i);
    if (!isEmptyParagraph(child)) return child.type.name === 'paragraph';
  }
  return false;
}

/**
 * A callout: its head line, then its blocks. A paragraph first in the body follows the head line directly, as the
 * shared fixtures write it. Its lines can't start another block, because SPEC 7.6 escapes every such start. Any other
 * block follows a blank line, since some, like a thematic break, would change the head line.
 */
function calloutEntry(node: PMNode, store: Store): CacheEntry {
  const title = node.firstChild;
  const type = CALLOUT_TYPE_PATTERN.test(node.attrs.type as string) ? (node.attrs.type as string) : 'note';
  const fold = (FOLDS as readonly string[]).includes(node.attrs.fold as string) ? (node.attrs.fold as string) : '';
  const line = title ? entryOf(title, '', store).text : '';
  const head = `[!${type}]${fold}${line === '' ? '' : ` ${line}`}`;
  const body = joinBlocks(node, 1, store);
  const gap = writesParagraphFirst(node, 1) ? '\n' : '\n\n';
  const inner = body.text === '' ? head : `${head}${gap}${body.text}`;
  const offset = head.length + gap.length;
  return {
    ctx: '',
    text: quoted(inner),
    inner,
    childStarts: withHead(NO_SPANS, shifted(body.starts, offset, inner.length), head.length - line.length),
    childEnds: withHead(NO_SPANS, shifted(body.ends, offset, inner.length), head.length),
    loose: false,
  };
}

/**
 * A list item: its blocks with every later line indented to the marker's width (`ctx`). The list writes the marker
 * on the first line. An item with no text can't be followed by a paragraph, so its blocks start on the next line. A
 * task item still has its `[ ]` line, which a block on the next line would join, so a blank line separates them.
 */
function itemEntry(item: PMNode, ctx: string, store: Store): CacheEntry {
  const first = item.firstChild;
  const lead = first ? entryOf(first, '', store).text : '';
  const rest = item.childCount > 1 ? joinBlocks(item, 1, store) : { text: '', starts: NO_SPANS, ends: NO_SPANS };
  const hasOthers = rest.text !== '';
  const checked = item.attrs.checked as boolean | null;
  const bare = lead === '' && checked === null && hasOthers;
  let inner: string;
  let leadAt: number;
  let restAt: number;
  if (bare) {
    inner = `\n${rest.text}`;
    leadAt = 0;
    restAt = 1;
  } else {
    const body = hasOthers ? `${lead}\n\n${rest.text}` : lead;
    const prefix = taskPrefix(checked);
    const head = lead === '' || lead.charCodeAt(0) === 10 ? prefix.trimEnd() : prefix;
    inner = head + body;
    leadAt = head.length;
    restAt = head.length + lead.length + 2;
  }
  return {
    ctx,
    text: indented(inner, Number(ctx)),
    inner,
    childStarts: withHead(NO_SPANS, shifted(rest.starts, restAt, inner.length), leadAt),
    childEnds: withHead(NO_SPANS, shifted(rest.ends, restAt, inner.length), leadAt + lead.length),
    loose: hasOthers,
  };
}

/** The marker joined to an item's text. An item whose first line is empty writes the marker without its space. */
export function itemLine(marker: string, text: string): string {
  return text === '' || text.charCodeAt(0) === 10 ? marker.trimEnd() + text : marker + text;
}

function listEntry(list: PMNode, store: Store): CacheEntry {
  const count = list.childCount;
  const lines: string[] = [];
  let loose = false;
  for (let i = 0; i < count; i++) {
    const marker = markerOf(list, i);
    const item = entryOf(list.child(i), String(marker.length), store);
    loose ||= item.loose;
    lines.push(itemLine(marker, item.text));
  }
  const gap = loose ? 2 : 1;
  const starts = new Int32Array(count);
  const ends = new Int32Array(count);
  let at = 0;
  lines.forEach((line, i) => {
    starts[i] = at;
    at += line.length;
    ends[i] = at;
    at += gap;
  });
  const text = lines.join(loose ? '\n\n' : '\n');
  return { ctx: '', text, inner: text, childStarts: starts, childEnds: ends, loose: false };
}

function build(node: PMNode, ctx: string, store: Store): CacheEntry {
  switch (node.type.name) {
    case 'doc':
      return blocksEntry(node, store);
    case 'paragraph':
      return leaf(serializeInline(node, PARAGRAPH));
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs.level) || 1));
      const text = serializeInline(node, TITLE, true);
      return leaf(text === '' ? '#'.repeat(level) : `${'#'.repeat(level)} ${text}`);
    }
    case 'calloutTitle':
      return leaf(serializeInline(node, TITLE, true));
    case 'bulletList':
    case 'orderedList':
      return listEntry(node, store);
    case 'listItem':
      return itemEntry(node, ctx, store);
    case 'blockquote':
      return quoteEntry(node, store);
    case 'callout':
      return calloutEntry(node, store);
    case 'codeBlock':
      return leaf(fenceText(node));
    case 'mathBlock':
      return leaf(`$$\n${cleanText(node.attrs.source as string)}\n$$`);
    case 'horizontalRule':
      return leaf('---');
    default:
      return leaf('');
  }
}

/** A node's entry: from the cache when it holds one made in the same context, else written now. */
export function entryOf(node: PMNode, ctx: string, store: Store): CacheEntry {
  const hit = store?.byNode.get(node);
  if (hit && hit.ctx === ctx) return hit;
  const made = build(node, ctx, store);
  store?.byNode.set(node, made);
  return made;
}

/** The canonical `markdown` string of a text block (SPEC 7.7): no blank line at the start, no newline at the end. */
export function serializeTextBlock(doc: PMNode, cache: MarkdownCache | null = null): string {
  return entryOf(doc, '', cache && stateOf(cache)).text;
}

/** A table cell's paragraph as one line, escaped like paragraph text. */
export function serializeCellParagraph(paragraph: PMNode, cache: MarkdownCache | null = null): string {
  const store = cache && stateOf(cache);
  const hit = store?.byNode.get(paragraph);
  if (hit && hit.ctx === 'cell') return hit.text;
  const made: CacheEntry = { ...leaf(serializeInline(paragraph, PARAGRAPH, true)), ctx: 'cell' };
  store?.byNode.set(paragraph, made);
  return made.text;
}

/**
 * After a mount, in idle time: writes the document once so that every node has its entry. Nothing is sent: a block
 * whose stored Markdown isn't canonical stays as it is until it is next edited (ARCHITECTURE.md section 9.5).
 */
export function warmCache(doc: PMNode, _markdown: string, cache: MarkdownCache): void {
  serializeTextBlock(doc, cache);
}
