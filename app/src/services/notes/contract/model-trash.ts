// Contract between the shell (Phase 2) and storage (Phase 3). Changes need approval from both phase owners.
//
// Trash and restore in the reference model. Trash moves whole subtrees (a page with its subpages) and returns
// a receipt. Restore puts each root back before the sibling that followed it, or else at the end of the parent.
// When the parent is gone, the root goes into a new notebook named after the old parent. A page also gets a
// section of that name.

import type { NodeSummary, PageLevel, TrashedItem, TrashReceipt, NodeId, TrashReceiptId } from '../types';
import { movedBlocksOf, normalizeLevels } from './model-moves';
import {
  displayOrder,
  fail,
  isLive,
  keyOf,
  listOf,
  live,
  newId,
  subtree,
  summary,
  validTitle,
  writable,
} from './model-state';
import type { ModelState, TrashEntry } from './model-state';

export function trash(state: ModelState, ids: readonly string[]): TrashReceipt {
  const recs = [...new Set(ids)].map((id) => live(state, id));
  recs.forEach((rec) => writable(state, rec));
  const order = displayOrder(state);
  const blocks = movedBlocksOf(state, recs).sort((a, b) => (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0));
  const gone = new Set(blocks.flat());
  const receiptId = newId(state, 'r');
  const trashedAt = state.now();
  const seq = state.counter;
  const entries = blocks.map((block): TrashEntry => {
    const rec = live(state, block[0]);
    const list = listOf(state, rec.parentId);
    const after = list.slice(list.indexOf(block[block.length - 1]) + 1).find((id) => !gone.has(id)) ?? null;
    const parentTitle = rec.parentId === null ? '' : live(state, rec.parentId).title;
    return {
      receiptId,
      rootId: rec.id,
      parentId: rec.parentId,
      beforeId: after,
      parentTitle,
      trashedAt,
      ids: block,
      seq,
    };
  });
  for (const entry of entries) {
    const list = listOf(state, entry.parentId);
    state.lists.set(
      keyOf(entry.parentId),
      list.filter((id) => !entry.ids.includes(id)),
    );
    entry.ids.flatMap((id) => subtree(state, id)).forEach((id) => state.trashed.add(id));
  }
  state.trash.push(...entries);
  return { id: receiptId as TrashReceiptId, nodeIds: entries.map((entry) => entry.rootId as NodeId) };
}

/** Where a restored root goes: its old parent, or a new notebook (and section, for pages) named after it. */
function restoreParent(state: ModelState, entry: TrashEntry, fallback: Map<string, string>): string | null {
  if (entry.parentId === null || isLive(state, entry.parentId)) return entry.parentId;
  const known = fallback.get(entry.parentId);
  if (known) return known;
  const title = validTitle(entry.parentTitle);
  const now = state.now();
  const make = (kind: 'notebook' | 'section', parentId: string | null) => {
    const id = newId(state, 'm');
    state.nodes.set(id, {
      id,
      kind,
      parentId,
      title,
      color: null,
      pageLevel: 0,
      created: now,
      modified: now,
      readOnly: false,
    });
    listOf(state, parentId).push(id);
    return id;
  };
  const notebook = make('notebook', null);
  const container = recOf(state, entry.rootId).kind === 'page' ? make('section', notebook) : notebook;
  fallback.set(entry.parentId, container);
  return container;
}

function restoreEntry(state: ModelState, entry: TrashEntry, fallback: Map<string, string>): NodeSummary {
  const parentId = restoreParent(state, entry, fallback);
  const list = listOf(state, parentId);
  const index = entry.beforeId !== null && isLive(state, entry.beforeId) ? list.indexOf(entry.beforeId) : -1;
  const at = index === -1 ? list.length : index;
  entry.ids.flatMap((id) => subtree(state, id)).forEach((id) => state.trashed.delete(id));
  entry.ids.forEach((id) => (live(state, id).parentId = parentId));
  list.splice(at, 0, ...entry.ids);
  if (parentId !== null && live(state, entry.rootId).kind === 'page') {
    fitBlock(state, list, at, entry.ids);
    normalizeLevels(state, parentId);
  }
  state.trash = state.trash.filter((other) => other !== entry);
  return summary(state, live(state, entry.rootId));
}

/** Raises a restored page block so its first page fits after the page before it; normalizing does the rest. */
function fitBlock(state: ModelState, list: readonly string[], at: number, ids: readonly string[]): void {
  const previous = at > 0 ? live(state, list[at - 1]).pageLevel : -1;
  const root = live(state, ids[0]).pageLevel;
  const delta = Math.min(root, previous + 1) - root;
  ids.forEach((id) => (live(state, id).pageLevel = (live(state, id).pageLevel + delta) as PageLevel));
}

export function restore(state: ModelState, receiptId: string): NodeSummary[] {
  const entries = state.trash.filter((entry) => entry.receiptId === receiptId);
  if (entries.length === 0) fail('not-found', `No receipt ${receiptId}`);
  writable(state);
  const fallback = new Map<string, string>();
  return entries.map((entry) => restoreEntry(state, entry, fallback));
}

export function restoreFromTrash(state: ModelState, ids: readonly string[]): NodeSummary[] {
  const entries = [...new Set(ids)].map((id) => {
    const entry = state.trash.find((candidate) => candidate.rootId === id);
    if (!entry) fail('not-found', `${id} isn't in Trash`);
    return entry;
  });
  writable(state);
  const fallback = new Map<string, string>();
  return entries.map((entry) => restoreEntry(state, entry, fallback));
}

/** Any node, including one in Trash. */
function recOf(state: ModelState, id: string) {
  return state.nodes.get(id) ?? fail('io', `Lost ${id}`);
}

function pageCount(state: ModelState, entry: TrashEntry): number {
  if (recOf(state, entry.rootId).kind === 'page') return entry.ids.length;
  return subtree(state, entry.rootId).filter((id) => state.nodes.get(id)?.kind === 'page').length;
}

export function listTrash(state: ModelState): TrashedItem[] {
  return [...state.trash]
    .sort((a, b) => b.seq - a.seq)
    .map((entry) => {
      return {
        receiptId: entry.receiptId as TrashReceiptId,
        node: summary(state, recOf(state, entry.rootId)),
        trashedAt: entry.trashedAt,
        originalParentId: entry.parentId as NodeId | null,
        originalParentTitle: entry.parentTitle,
        pageCount: pageCount(state, entry),
      };
    });
}
