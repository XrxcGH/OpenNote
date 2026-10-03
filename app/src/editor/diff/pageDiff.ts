// Compares two versions of a page (ARCHITECTURE.md section 21; owner: WP7). Blocks match by ID. In a text block, the
// top-level blocks (paragraphs, headings, lists, quotes) are compared with Myers' diff over their Markdown; adjacent
// removed and added runs pair up as changed paragraphs when at least half their words match, with a word diff
// inside. Tables compare by row and column ID, cell by cell; images by crop, size, and alt text. Moves are noted.
import type { Node as PMNode } from '@tiptap/pm/model';
import { createMarkdownCache, parseTextBlock, serializeTextBlock } from '../markdown';
import { diffWords, myersDiff, wordSimilarity } from './myers';
import type { WordPart } from './myers';

/** The parts of a page's JSON the comparison reads; PageJson fits. */
export interface DiffBlock {
  readonly id: string;
  readonly type: string;
  readonly order: string;
  readonly frame?: { x?: number; y?: number; w?: number; h?: number; rotate?: number };
  readonly data: Record<string, unknown>;
}

export interface DiffPage {
  readonly blocks: readonly DiffBlock[];
  readonly [key: string]: unknown;
}

export type Status = 'same' | 'added' | 'removed' | 'changed';

/** A top-level block of a text block. Indexes are into each version's list of top-level blocks. */
export interface ParagraphChange {
  status: Status;
  before: { index: number; markdown: string; node: PMNode } | null;
  after: { index: number; markdown: string; node: PMNode } | null;
  /** For a changed paragraph, the word diff of its text. */
  words: WordPart[] | null;
}

export interface CellChange {
  row: string;
  column: string;
  status: Status;
  before: string | null;
  after: string | null;
}

export type BlockChange =
  | { kind: 'text'; id: string; status: Status; moved: boolean; paragraphs: ParagraphChange[] }
  | { kind: 'table'; id: string; status: Status; moved: boolean; cells: CellChange[]; rows: TableRows }
  | { kind: 'image'; id: string; status: Status; moved: boolean; notes: ('crop' | 'size' | 'alt')[]; alt: string }
  | { kind: 'other'; id: string; type: string; status: Status; moved: boolean };

export interface TableRows {
  added: number;
  removed: number;
}

export interface PageDiff {
  blocks: BlockChange[];
  counts: { added: number; removed: number; changed: number; moved: number };
  /** Strokes added and removed, when the page has ink. */
  ink: { added: number; removed: number } | null;
}

const PAIRING = 0.5;
const cache = createMarkdownCache();

/** A text block's top-level blocks, each with its own Markdown. */
export function topLevelBlocks(markdown: string): { markdown: string; node: PMNode }[] {
  const doc = parseTextBlock(markdown);
  const parts: { markdown: string; node: PMNode }[] = [];
  doc.forEach((node) => {
    parts.push({ markdown: serializeTextBlock(doc.type.create(null, [node]), cache).trim(), node });
  });
  return parts;
}

const markdownOf = (block: DiffBlock | undefined) => {
  const value = block?.data.markdown;
  return typeof value === 'string' ? value : '';
};

/** Pairs a run of removed paragraphs with the run of added ones after it, in order, when their words match. */
function pairRuns(removed: ParagraphChange[], added: ParagraphChange[]): ParagraphChange[] {
  const out: ParagraphChange[] = [];
  let next = 0;
  for (const gone of removed) {
    const match = added.findIndex(
      (item, index) =>
        index >= next && wordSimilarity(gone.before!.node.textContent, item.after!.node.textContent) >= PAIRING,
    );
    if (match < 0) {
      out.push(gone);
      continue;
    }
    out.push(...added.slice(next, match));
    const pair = added[match];
    const words = diffWords(gone.before!.node.textContent, pair.after!.node.textContent);
    out.push({ status: 'changed', before: gone.before, after: pair.after, words });
    next = match + 1;
  }
  return [...out, ...added.slice(next)];
}

export function diffText(before: string, after: string): ParagraphChange[] {
  const a = topLevelBlocks(before);
  const b = topLevelBlocks(after);
  const ops = myersDiff(a, b, (x, y) => x.markdown === y.markdown);
  const out: ParagraphChange[] = [];
  let removed: ParagraphChange[] = [];
  let added: ParagraphChange[] = [];
  const flush = () => {
    out.push(...pairRuns(removed, added));
    removed = [];
    added = [];
  };
  for (const op of ops) {
    if (op.kind === 'delete') {
      removed.push({ status: 'removed', before: { index: op.a, ...a[op.a] }, after: null, words: null });
    } else if (op.kind === 'insert') {
      added.push({ status: 'added', before: null, after: { index: op.b, ...b[op.b] }, words: null });
    } else {
      flush();
      out.push({
        status: 'same',
        before: { index: op.a, ...a[op.a] },
        after: { index: op.b, ...b[op.b] },
        words: null,
      });
    }
  }
  flush();
  return out;
}

interface TableJson {
  columns?: { id: string }[];
  rows?: { id: string; cells?: Record<string, { markdown?: string }> }[];
}

function diffTable(
  before: DiffBlock | undefined,
  after: DiffBlock | undefined,
): { cells: CellChange[]; rows: TableRows } {
  const a = (before?.data ?? {}) as TableJson;
  const b = (after?.data ?? {}) as TableJson;
  const cell = (table: TableJson, row: string, column: string) =>
    table.rows?.find((r) => r.id === row)?.cells?.[column]?.markdown ?? null;
  const rowIds = (table: TableJson) => (table.rows ?? []).map((row) => row.id);
  const columnIds = (table: TableJson) => (table.columns ?? []).map((column) => column.id);
  const rows = [...new Set([...rowIds(a), ...rowIds(b)])];
  const columns = [...new Set([...columnIds(a), ...columnIds(b)])];
  const cells: CellChange[] = [];
  for (const row of rows) {
    for (const column of columns) {
      const was = cell(a, row, column);
      const now = cell(b, row, column);
      if (was === now) continue;
      const status: Status = was === null ? 'added' : now === null ? 'removed' : 'changed';
      cells.push({ row, column, status, before: was, after: now });
    }
  }
  const counted = (from: TableJson, to: TableJson) => rowIds(from).filter((id) => !rowIds(to).includes(id)).length;
  return { cells, rows: { added: counted(b, a), removed: counted(a, b) } };
}

function imageNotes(before: DiffBlock, after: DiffBlock): ('crop' | 'size' | 'alt')[] {
  const notes: ('crop' | 'size' | 'alt')[] = [];
  if (JSON.stringify(before.data.crop ?? null) !== JSON.stringify(after.data.crop ?? null)) notes.push('crop');
  if (before.frame?.w !== after.frame?.w || before.frame?.h !== after.frame?.h) notes.push('size');
  if ((before.data.alt ?? '') !== (after.data.alt ?? '')) notes.push('alt');
  return notes;
}

/** Blocks whose place among the blocks both versions have changed, or whose position on the page changed. */
function movedBlocks(before: DiffPage, after: DiffPage): Set<string> {
  const ids = (page: DiffPage, other: DiffPage) =>
    [...page.blocks]
      .filter((block) => other.blocks.some((o) => o.id === block.id))
      .sort((x, y) => (x.order < y.order ? -1 : x.order > y.order ? 1 : 0))
      .map((block) => block.id);
  const moved = new Set(
    myersDiff(ids(before, after), ids(after, before))
      .filter((op) => op.kind === 'delete')
      .map((op) => ids(before, after)[(op as { a: number }).a]),
  );
  for (const block of after.blocks) {
    const old = before.blocks.find((b) => b.id === block.id);
    if (old && (old.frame?.x !== block.frame?.x || old.frame?.y !== block.frame?.y)) moved.add(block.id);
  }
  return moved;
}

function compareBlock(before: DiffBlock | undefined, after: DiffBlock | undefined, moved: boolean): BlockChange {
  const block = (after ?? before)!;
  const presence: Status = !before ? 'added' : !after ? 'removed' : 'same';
  const settle = (changed: boolean): Status => (presence === 'same' && changed ? 'changed' : presence);
  if (block.type === 'text') {
    const paragraphs = diffText(markdownOf(before), markdownOf(after));
    return {
      kind: 'text',
      id: block.id,
      moved,
      paragraphs,
      status: settle(paragraphs.some((p) => p.status !== 'same')),
    };
  }
  if (block.type === 'table') {
    const { cells, rows } = diffTable(before, after);
    return { kind: 'table', id: block.id, moved, cells, rows, status: settle(cells.length > 0) };
  }
  if (block.type === 'image') {
    const notes = before && after ? imageNotes(before, after) : [];
    const alt = typeof block.data.alt === 'string' ? block.data.alt : '';
    return { kind: 'image', id: block.id, moved, notes, alt, status: settle(notes.length > 0) };
  }
  const changed = JSON.stringify(before?.data) !== JSON.stringify(after?.data);
  return { kind: 'other', id: block.id, type: block.type, moved, status: settle(changed) };
}

function strokeIds(page: DiffPage): string[] {
  const ink = page.ink as { strokes?: { id?: string }[] } | undefined;
  return (ink?.strokes ?? []).map((stroke, index) => stroke.id ?? String(index));
}

/** Compares `before` (an older version) with `after`, in `after`'s block order with removed blocks in place. */
export function diffPages(before: DiffPage, after: DiffPage): PageDiff {
  const moved = movedBlocks(before, after);
  const byOrder = (x: DiffBlock, y: DiffBlock) => (x.order < y.order ? -1 : x.order > y.order ? 1 : 0);
  const ordered = [...after.blocks, ...before.blocks.filter((b) => !after.blocks.some((a) => a.id === b.id))].sort(
    byOrder,
  );
  const blocks = ordered.map((block) =>
    compareBlock(
      before.blocks.find((b) => b.id === block.id),
      after.blocks.find((a) => a.id === block.id),
      moved.has(block.id),
    ),
  );
  const count = (status: Status) => blocks.filter((block) => block.status === status).length;
  const strokesBefore = strokeIds(before);
  const strokesAfter = strokeIds(after);
  const added = strokesAfter.filter((id) => !strokesBefore.includes(id)).length;
  const removed = strokesBefore.filter((id) => !strokesAfter.includes(id)).length;
  return {
    blocks,
    counts: { added: count('added'), removed: count('removed'), changed: count('changed'), moved: moved.size },
    ink: added || removed ? { added, removed } : null,
  };
}
