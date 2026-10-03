// Re-parsing only the range of a block that changed (ARCHITECTURE.md section 9.3). Undo, redo, and frames from other
// windows deliver a block's new Markdown. Parsing a long block again on the main thread can miss the feedback budget.
// So this finds the splice and walks down through the containers that hold all of it, using each cache entry's child
// spans. It parses only the children the splice touches, widened by one sibling on each side.
//
// The new document is written again and compared with the new Markdown. Every canonical string round-trips (section
// 9.4), so equal text proves the result equals a full parse. When a level can't prove it, the level above tries.
// When no level can, the caller parses the whole block.
import { Fragment, Slice } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import { textSchema } from '../schema/schema';
import { stateOf } from './cache';
import type { CacheEntry, CacheState, MarkdownCache } from './cache';
import { parseBlocks } from './parse';
import { entryOf, markerOf, serializeTextBlock } from './serialize';
import { diffMarkdown } from './splice';
import type { MarkdownSplice } from './splice';

/**
 * Replace the document's content between `from` and `to` with `content`, in the document's own schema, or parse
 * the whole block again. `from` equals `to` and `content` is empty when nothing changed.
 */
export type Reparse = { from: number; to: number; content: Fragment } | 'full';

type Kind = 'blocks' | 'callout' | 'list' | 'item';

const KINDS: Readonly<Record<string, Kind>> = {
  blockquote: 'blocks',
  callout: 'callout',
  bulletList: 'list',
  orderedList: 'list',
  listItem: 'item',
};

/** One container on the way down, with its text before and after the change, without its own prefixes. */
interface Level {
  readonly node: PMNode;
  readonly entry: CacheEntry;
  /** Where the node's content starts in the document. */
  readonly pos: number;
  readonly kind: Kind;
  readonly after: string;
  readonly splice: MarkdownSplice;
}

/** A quote's lines without their `> `, or null when a line has none. */
function unquote(text: string): string | null {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '>') lines[i] = '';
    else if (lines[i].startsWith('> ')) lines[i] = lines[i].slice(2);
    else return null;
  }
  return lines.join('\n');
}

/** Lines after the first without their indent, or null when a line that holds text is indented less. */
function unindent(text: string, width: number): string | null {
  const pad = ' '.repeat(width);
  const lines = text.split('\n');
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '') continue;
    if (!lines[i].startsWith(pad)) return null;
    lines[i] = lines[i].slice(width);
  }
  return lines.join('\n');
}

/** An item's text from its line in the list, without the marker. The marker must not have changed. */
function itemText(line: string, marker: string): string | null {
  if (line.startsWith(marker)) return unindent(line.slice(marker.length), marker.length);
  const bare = marker.trimEnd();
  if (line !== bare && !line.startsWith(`${bare}\n`)) return null;
  return unindent(line.slice(bare.length), marker.length);
}

function offsetOf(node: PMNode, index: number): number {
  let offset = 0;
  for (let i = 0; i < index; i++) offset += node.child(i).nodeSize;
  return offset;
}

const firstChild = (kind: Kind) => (kind === 'callout' ? 1 : 0);

/** The one child whose text holds the whole splice, or -1. */
function holder({ entry, kind, splice }: Level): number {
  const { childStarts: starts, childEnds: ends } = entry;
  if (!starts || !ends) return -1;
  const end = splice.at + splice.del.length;
  for (let i = firstChild(kind); i < starts.length; i++) {
    if (starts[i] <= splice.at && end <= ends[i] && starts[i] < ends[i]) return i;
  }
  return -1;
}

/** The level for child `index` of `level`, when it is a container whose prefixes the new text still has. */
function descend(level: Level, index: number, store: CacheState): Level | null {
  const child = level.node.child(index);
  const kind = KINDS[child.type.name] as Kind | undefined;
  const starts = level.entry.childStarts;
  const ends = level.entry.childEnds;
  if (!kind || !starts || !ends) return null;
  const marker = level.kind === 'list' ? markerOf(level.node, index) : '';
  const entry = store.byNode.get(child);
  if (!entry || entry.ctx !== (marker === '' ? '' : String(marker.length))) return null;
  const delta = level.splice.ins.length - level.splice.del.length;
  const region = level.after.slice(starts[index], ends[index] + delta);
  let after: string | null = region;
  if (kind === 'blocks' || kind === 'callout') after = unquote(region);
  else if (kind === 'item') after = itemText(region, marker);
  const splice = after === null ? null : diffMarkdown(entry.inner, after);
  if (after === null || !splice) return null;
  const pos = level.pos + offsetOf(level.node, index) + 1;
  return { node: child, entry, pos, kind, after, splice };
}

function childrenOf(node: PMNode): PMNode[] {
  const out: PMNode[] = [];
  node.forEach((child) => out.push(child));
  return out;
}

/** The new children for a range of a level, parsed from its new text, or null when they don't fit the level. */
function parseRange(level: Level, text: string): PMNode[] | null {
  const blocks = parseBlocks(text);
  if (level.kind !== 'list') return blocks;
  const [list] = blocks;
  return blocks.length === 1 && list.type.name === level.node.type.name ? childrenOf(list) : null;
}

/** The replacement at one level, proved by writing the result, or null. */
function tryLevel(doc: PMNode, level: Level, next: string, store: CacheState): Reparse | null {
  const { node, entry, kind, splice } = level;
  const starts = entry.childStarts;
  const ends = entry.childEnds;
  const count = node.childCount;
  const first = firstChild(kind);
  if (!starts || !ends || starts.length !== count || count <= first) return null;
  const end = splice.at + splice.del.length;
  // A change to a callout's head or an item's task box changes the container itself.
  if (splice.at < starts[first]) return null;
  let a = first;
  while (a < count - 1 && ends[a] < splice.at) a++;
  let b = count - 1;
  while (b > a && starts[b] > end) b--;
  a = Math.max(first, a - 1);
  b = Math.min(count - 1, b + 1);
  if (splice.at < starts[a] || end > ends[b]) return null;
  const delta = splice.ins.length - splice.del.length;
  let nodes = parseRange(level, level.after.slice(starts[a], ends[b] + delta));
  if (!nodes) return null;
  const schema = doc.type.schema;
  if (schema !== textSchema) nodes = nodes.map((child) => schema.nodeFromJSON(child.toJSON()));
  // Unchanged children at either end keep their identity, and with it their cache entries.
  let lo = a;
  let hi = b + 1;
  let s = 0;
  let e = nodes.length;
  while (lo < hi && s < e && node.child(lo).eq(nodes[s])) [lo, s] = [lo + 1, s + 1];
  while (hi > lo && e > s && node.child(hi - 1).eq(nodes[e - 1])) [hi, e] = [hi - 1, e - 1];
  const from = level.pos + offsetOf(node, lo);
  const to = from + offsetOf(node, hi) - offsetOf(node, lo);
  const content = Fragment.fromArray(nodes.slice(s, e));
  try {
    const result = doc.replace(from, to, new Slice(content, 0, 0));
    return serializeTextBlock(result, store) === next ? { from, to, content } : null;
  } catch {
    return null;
  }
}

function rangeFor(doc: PMNode, docMarkdown: string, next: string, store: CacheState): Reparse {
  const entry = entryOf(doc, '', store);
  if (entry.text !== docMarkdown) return 'full';
  const splice = diffMarkdown(docMarkdown, next);
  if (!splice) return { from: 0, to: 0, content: Fragment.empty };
  const levels: Level[] = [{ node: doc, entry, pos: 0, kind: 'blocks', after: next, splice }];
  for (;;) {
    const level = levels[levels.length - 1];
    const index = holder(level);
    const inner = index < 0 ? null : descend(level, index, store);
    if (!inner) break;
    levels.push(inner);
  }
  for (let i = levels.length - 1; i >= 0; i--) {
    const result = tryLevel(doc, levels[i], next, store);
    if (result) return result;
  }
  return 'full';
}

/**
 * How to turn `doc`, whose Markdown is `docMarkdown`, into the document for `next`. Never throws: anything it can't
 * prove asks for a full parse.
 */
export function reparseRange(doc: PMNode, docMarkdown: string, next: string, cache: MarkdownCache): Reparse {
  try {
    return rangeFor(doc, docMarkdown, next, stateOf(cache));
  } catch {
    return 'full';
  }
}
