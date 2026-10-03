// Contract between the shell (Phase 2) and storage (Phase 3). Changes need approval from both phase owners.
//
// Trash and restore in the reference model. Trash moves whole subtrees (a page with its subpages) and returns
// a receipt. Restore puts each root back before the sibling that followed it, or else at the end of the parent.
// Each notebook keeps its own Trash, as Phase 3's format does (ADR 0014):
//
// - Without its parent, a restored container goes to the end of its notebook. A page goes into a new section
//   at the end of its notebook, named after the old section. A group that would nest too deep goes there too.
//
// - While a notebook is in Trash, the items trashed from inside it are hidden and can't be restored.

import type { NodeSummary, PageLevel, TrashedItem, TrashReceipt, NodeId, TrashReceiptId } from '../types';
import { movedBlocksOf, normalizeLevels } from './model-moves';
import {
  displayOrder,
  fail,
  fitsDepth,
  groupHeight,
  isLive,
  keyOf,
  listOf,
  live,
  newId,
  notebookOf,
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
    const notebookId = notebookOf(state, rec.id);
    return {
      receiptId,
      rootId: rec.id,
      parentId: rec.parentId,
      beforeId: after,
      parentTitle,
      notebookId,
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

/** Listed and restorable: a notebook, or an item whose notebook isn't in Trash. */
export function isListed(state: ModelState, entry: TrashEntry): boolean {
  return entry.notebookId === null || isLive(state, entry.notebookId);
}

/** The old parent, if it is still there and the root still fits in it. */
function originalParent(state: ModelState, entry: TrashEntry): string | null | undefined {
  if (entry.parentId === null) return null;
  if (!isLive(state, entry.parentId)) return undefined;
  return fitsDepth(state, entry.parentId, groupHeight(state, entry.rootId)) ? entry.parentId : undefined;
}

/** Where a restored root goes: its old parent, else the end of its notebook, in a new section for a page. */
function restoreParent(state: ModelState, entry: TrashEntry, fallback: Map<string, string>): string | null {
  const original = originalParent(state, entry);
  if (original !== undefined) return original;
  const notebookId = entry.notebookId ?? fail('io', `Lost the notebook of ${entry.rootId}`);
  if (recOf(state, entry.rootId).kind !== 'page') return notebookId;
  const known = fallback.get(entry.parentId ?? '');
  if (known) return known;
  const id = newId(state, 'm');
  const now = state.now();
  const title = validTitle(entry.parentTitle);
  state.nodes.set(id, {
    id,
    kind: 'section',
    parentId: notebookId,
    title,
    color: null,
    pageLevel: 0,
    created: now,
    modified: now,
    readOnly: false,
  });
  listOf(state, notebookId).push(id);
  fallback.set(entry.parentId ?? '', id);
  return id;
}

function restoreEntry(state: ModelState, entry: TrashEntry, fallback: Map<string, string>): NodeSummary {
  const parentId = restoreParent(state, entry, fallback);
  const list = listOf(state, parentId);
  const before = parentId === entry.parentId && entry.beforeId !== null && isLive(state, entry.beforeId);
  const index = before ? list.indexOf(entry.beforeId as string) : -1;
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
  const entries = state.trash.filter((entry) => entry.receiptId === receiptId && isListed(state, entry));
  if (entries.length === 0) fail('not-found', `Nothing left of receipt ${receiptId}`);
  writable(state);
  const fallback = new Map<string, string>();
  return entries.map((entry) => restoreEntry(state, entry, fallback));
}

export function restoreFromTrash(state: ModelState, ids: readonly string[]): NodeSummary[] {
  const entries = [...new Set(ids)].map((id) => {
    const entry = state.trash.find((candidate) => candidate.rootId === id && isListed(state, candidate));
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
  return state.trash
    .filter((entry) => isListed(state, entry))
    .sort((a, b) => b.seq - a.seq)
    .map((entry) => ({
      receiptId: entry.receiptId as TrashReceiptId,
      node: summary(state, recOf(state, entry.rootId)),
      trashedAt: entry.trashedAt,
      originalParentId: entry.parentId as NodeId | null,
      originalParentTitle: entry.parentTitle,
      pageCount: pageCount(state, entry),
    }));
}
