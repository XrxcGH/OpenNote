// Pin, sort, duplicate, and archive for the tree (docs/FEATURES.md, "Pin, sort, duplicate and copy pages and
// sections" and "Archive"). Pins and archive marks are kept in the notebook files by the shell; sorting is a
// move, so it joins the undo stack like any other move.

import { shellCall } from '../../platform/shellqol';
import type { NodeId, NodeSummary, NotesService } from '../../services/notes';
import { qolStore } from '../../state/qol';
import { t } from '../../strings/t';
import { announce, showToast } from '../../ui';
import { blockOf, moveNodes, titleOf, trashNodes } from './actions';
import { toastError } from './errors';
import { relist } from './load';
import { childrenOf, getNode, mergeNodes, requestFocus, treeOf, treeStore } from './store';
import { recordUndo } from './undo';

export type SortKey = 'title' | 'created' | 'modified';

/** Puts a node the shell answered with into the tree store. */
function adopt(node: NodeSummary): void {
  treeStore.set((state) => {
    const nodes = mergeNodes(state.nodes, [node]);
    return nodes === state.nodes ? state : { ...state, nodes };
  });
}

/** Pins or unpins a page. */
export async function setPinned(id: NodeId, pinned: boolean): Promise<void> {
  const node = getNode(id);
  if (!node || node.kind !== 'page') return;
  try {
    adopt(await shellCall<NodeSummary>('notes.setPinned', { id, pinned }));
  } catch (error) {
    toastError(error, titleOf(node));
    return;
  }
  announce(t(pinned ? 'qol.pin.pinned' : 'qol.pin.unpinned', { title: titleOf(node) }));
}

/** Archives or restores a node. Archived rows leave the tree unless Show archived is on. */
export async function setArchived(id: NodeId, archived: boolean, record = true): Promise<void> {
  const node = getNode(id);
  if (!node) return;
  try {
    adopt(await shellCall<NodeSummary>('notes.setArchived', { id, archived }));
  } catch (error) {
    toastError(error, titleOf(node));
    return;
  }
  const title = titleOf(node);
  if (!record) return;
  recordUndo({
    undone: t(archived ? 'qol.archive.undoArchive' : 'qol.archive.undoRestore', { title }),
    redone: t(archived ? 'qol.archive.redoArchive' : 'qol.archive.redoRestore', { title }),
    undo: () => setArchived(id, !archived, false),
    redo: () => setArchived(id, archived, false),
  });
  showToast({
    message: t(archived ? 'qol.archive.archived' : 'qol.archive.restored', { title }),
    action: archived ? { label: t('tree.trash.undo'), run: () => void setArchived(id, false, false) } : undefined,
  });
}

/** Duplicates a page (it lands right after the original) or a section, and takes the copy back on undo. */
export async function duplicateNode(id: NodeId): Promise<void> {
  const node = getNode(id);
  if (!node) return;
  let made: NodeSummary[];
  try {
    made = await shellCall<NodeSummary[]>('notes.duplicate', { id });
  } catch (error) {
    toastError(error, titleOf(node));
    return;
  }
  await relist(node.parentId);
  const copies = made.map((copy) => copy.id);
  let receipt = null as Awaited<ReturnType<typeof trashNodes>>;
  recordUndo({
    undone: t('qol.duplicate.undone', { title: titleOf(node) }),
    redone: t('qol.duplicate.redone', { title: titleOf(node) }),
    undo: async (service) => {
      receipt = await trashNodes(service, copies, { record: false });
    },
    redo: async (service) => {
      if (receipt) await service.restore(receipt.id);
      await relist(node.parentId);
    },
  });
  showToast({ message: t('qol.duplicate.done', { title: titleOf(node) }) });
  const first = made[0] && getNode(made[0].id);
  if (first) requestFocus(treeOf(first), first.id);
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * The ids in the order a sort gives. Titles run A to Z; dates run newest first. A pinned page stays above the
 * others, and ties keep the order they had.
 */
export function sortedIds(nodes: readonly NodeSummary[], by: SortKey): NodeId[] {
  const key = (node: NodeSummary) => (by === 'title' ? titleOf(node) : by === 'created' ? node.created : node.modified);
  const compare = (a: NodeSummary, b: NodeSummary) =>
    by === 'title' ? collator.compare(key(a), key(b)) : key(b).localeCompare(key(a));
  return nodes
    .map((node, index) => ({ node, index }))
    .sort((a, b) => Number(!!b.node.pinned) - Number(!!a.node.pinned) || compare(a.node, b.node) || a.index - b.index)
    .map((item) => item.node.id);
}

/** The heads of a section page blocks: top-level pages, each standing for its subpages. */
function topLevel(nodes: readonly NodeSummary[]): NodeSummary[] {
  return nodes.filter((node) => node.kind !== 'page' || node.pageLevel === 0);
}

/** Sorts the list a node is in: a section pages, or the sections and groups of a notebook or group. */
export async function sortSiblings(notes: NotesService, node: NodeSummary, by: SortKey): Promise<void> {
  const siblings = topLevel(childrenOf(treeStore.get(), node.parentId));
  const order = sortedIds(siblings, by);
  if (order.every((id, index) => id === siblings[index].id)) {
    announce(t('qol.sort.already'));
    return;
  }
  // Moving the heads in the new order carries each page along with its subpages.
  const expected = new Set(siblings.flatMap((sibling) => blockOf(treeStore.get(), sibling.id)));
  if (expected.size === 0) return;
  try {
    await moveNodes(notes, order, { parentId: node.parentId, beforeId: null });
  } catch (error) {
    toastError(error, titleOf(node));
    return;
  }
  announce(t(`qol.sort.done.${by}`));
}

/** Shows or hides archived items in the tree. */
export function setShowArchived(show: boolean): void {
  qolStore.set((state) => (state.showArchived === show ? state : { ...state, showArchived: show }));
  announce(t(show ? 'qol.archive.shown' : 'qol.archive.hidden'));
}
