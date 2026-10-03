// Trash in the in-memory library (ARCHITECTURE.md section 12.2 and ADR 0014). Each trashed root is its own
// record, kept in its notebook's Trash:
//
// - Restore puts a root back before the sibling that followed it, else at the end of its parent.
//
// - Without its parent, a container goes to the end of its notebook, and a page goes into a new section there,
//   named after the old one. A group that would nest too deep goes to the end of its notebook too.
//
// - Records from inside a notebook that is itself in Trash are hidden until the notebook is back.

import type { NodeId, NodeSummary, PageLevel, TrashedItem, TrashReceipt, TrashReceiptId } from '../types';
import type { Library, MemNode, TrashRecord } from './library';
import { checkedTitle, fail } from './library';
import { fitBlocks, normalized } from './pages';
import { movedBlocks } from './writes';

export interface Stamp {
  readonly receiptId: string;
  readonly now: string;
}

export function trash(lib: Library, ids: readonly string[], stamp: Stamp): TrashReceipt {
  const nodes = [...new Set(ids)].map((id) => lib.live(id));
  nodes.forEach((node) => lib.writable(node));
  const order = lib.displayOrder();
  const blocks = movedBlocks(lib, nodes).sort((a, b) => (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0));
  const gone = new Set(blocks.flat());
  const records = blocks.map((block): TrashRecord => {
    const root = lib.any(block[0]);
    const siblings = lib.kidsOf(root.parentId);
    const after = siblings.slice(siblings.indexOf(block[block.length - 1]) + 1).find((id) => !gone.has(id));
    return {
      receiptId: stamp.receiptId,
      ids: block,
      parentId: root.parentId,
      beforeId: after ?? null,
      parentTitle: root.parentId === null ? '' : lib.any(root.parentId).title,
      notebookId: lib.notebookOf(root.id),
      trashedAt: stamp.now,
    };
  });
  for (const record of records) {
    lib.setKids(
      record.parentId,
      lib.kidsOf(record.parentId).filter((id) => !record.ids.includes(id)),
    );
    for (const id of record.ids.flatMap((root) => lib.subtree(root))) lib.trashed.add(id);
  }
  lib.records.push(...records);
  return { id: stamp.receiptId as TrashReceiptId, nodeIds: records.map((record) => record.ids[0] as NodeId) };
}

export function isListed(lib: Library, record: TrashRecord): boolean {
  return record.notebookId === null || lib.isLive(record.notebookId);
}

/** New sections made while restoring, by the id of the section they replace. */
type Fallbacks = Map<string, string>;

export interface Maker {
  newId(kind: 'section'): string;
  readonly now: string;
}

function destination(lib: Library, record: TrashRecord, made: Fallbacks, maker: Maker): string | null {
  const root = lib.any(record.ids[0]);
  if (record.parentId === null) return null;
  if (lib.isLive(record.parentId) && lib.fitsDepth(record.parentId, root.id)) return record.parentId;
  const notebookId = record.notebookId ?? fail('io', `Lost the notebook of ${root.id}`);
  if (root.kind !== 'page') return notebookId;
  const known = made.get(record.parentId);
  if (known) return known;
  const section: MemNode = {
    id: maker.newId('section'),
    kind: 'section',
    parentId: notebookId,
    title: checkedTitle(record.parentTitle),
    color: null,
    pageLevel: 0,
    created: maker.now,
    modified: maker.now,
    readOnly: false,
  };
  lib.nodes.set(section.id, section);
  lib.kidsOf(notebookId).push(section.id);
  made.set(record.parentId, section.id);
  return section.id;
}

function putBack(lib: Library, record: TrashRecord, made: Fallbacks, maker: Maker): NodeSummary {
  const parentId = destination(lib, record, made, maker);
  const list = lib.kidsOf(parentId);
  const sameParent = parentId === record.parentId && lib.isLive(record.beforeId);
  const found = sameParent ? list.indexOf(record.beforeId as string) : -1;
  const at = found === -1 ? list.length : found;
  for (const id of record.ids.flatMap((root) => lib.subtree(root))) lib.trashed.delete(id);
  for (const id of record.ids) lib.any(id).parentId = parentId;
  list.splice(at, 0, ...record.ids);
  if (parentId !== null && lib.any(record.ids[0]).kind === 'page') refit(lib, list, at, record.ids.length);
  lib.records = lib.records.filter((other) => other !== record);
  return lib.summary(lib.any(record.ids[0]));
}

/** Raises a restored page block to fit after the page before it, then clamps the pages after it. */
function refit(lib: Library, list: readonly string[], at: number, count: number): void {
  const levels = list.map((id) => lib.any(id).pageLevel as number);
  const block = levels.slice(at, at + count);
  const [fitted] = fitBlocks(at > 0 ? levels[at - 1] : -1, [block], undefined) ?? [block];
  levels.splice(at, count, ...fitted);
  normalized(levels).forEach((level, i) => (lib.any(list[i]).pageLevel = level as PageLevel));
}

export function restore(lib: Library, receiptId: string, maker: Maker): NodeSummary[] {
  const records = lib.records.filter((record) => record.receiptId === receiptId && isListed(lib, record));
  if (records.length === 0) fail('not-found', `Nothing is left of the receipt ${receiptId}`);
  lib.writable();
  const made: Fallbacks = new Map();
  return records.map((record) => putBack(lib, record, made, maker));
}

export function restoreFromTrash(lib: Library, ids: readonly string[], maker: Maker): NodeSummary[] {
  const records = [...new Set(ids)].map(
    (id) =>
      lib.records.find((record) => record.ids[0] === id && isListed(lib, record)) ??
      fail('not-found', `${id} isn't in Trash`),
  );
  lib.writable();
  const made: Fallbacks = new Map();
  return records.map((record) => putBack(lib, record, made, maker));
}

function pageCount(lib: Library, record: TrashRecord): number {
  if (lib.any(record.ids[0]).kind === 'page') return record.ids.length;
  return lib.subtree(record.ids[0]).filter((id) => lib.nodes.get(id)?.kind === 'page').length;
}

/** Listed items, newest first. */
export function listTrash(lib: Library): TrashedItem[] {
  return lib.records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => isListed(lib, record))
    .sort((a, b) => (a.record.receiptId === b.record.receiptId ? a.index - b.index : b.index - a.index))
    .map(({ record }) => ({
      receiptId: record.receiptId as TrashReceiptId,
      node: lib.summary(lib.any(record.ids[0])),
      trashedAt: record.trashedAt,
      originalParentId: record.parentId as NodeId | null,
      originalParentTitle: record.parentTitle,
      pageCount: pageCount(lib, record),
    }));
}
