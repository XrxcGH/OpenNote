// Tree actions (ARCHITECTURE.md section 13.1). Each applies its change to the store at once, so the row changes
// in the same frame as the input, then calls the service. On a refusal it puts the store back, re-lists what it
// touched, and throws, so the caller can explain in a toast or in the rename field. Each change it makes joins
// the undo stack, unless it is itself an undo or redo.

import type {
  ChipColor,
  NodeId,
  NodeSummary,
  NotesService,
  PageLevel,
  Placement,
  TrashReceipt,
} from '../../services/notes';
import { t } from '../../strings/t';
import { relist } from './load';
import { childrenOf, getNode, keyOf, treeStore, withoutNodes } from './store';
import type { TreeState } from './store';
import { recordUndo } from './undo';

export interface ActionOptions {
  /** False for undo and redo, which mustn't join the stack. Default true. */
  readonly record?: boolean;
}

/** The title to show and speak: an empty page title reads as "Untitled page". */
export function titleOf(node: Pick<NodeSummary, 'title' | 'kind'> | undefined): string {
  if (!node) return '';
  return node.title.trim() || t(`tree.untitled.${node.kind}`);
}

/** Runs a change optimistically, and puts back the touched parents and nodes when the service refuses it. */
async function optimistic<T>(
  touched: { parents: readonly (NodeId | null)[]; nodes: readonly string[] },
  local: (state: TreeState) => TreeState,
  remote: () => Promise<T>,
): Promise<T> {
  const before = treeStore.get();
  treeStore.set(local);
  try {
    return await remote();
  } catch (error) {
    treeStore.set((state) => {
      const children = { ...state.children };
      for (const key of touched.parents.map(keyOf)) {
        if (key in before.children) children[key] = before.children[key];
      }
      const nodes = { ...state.nodes };
      for (const id of touched.nodes) if (before.nodes[id]) nodes[id] = before.nodes[id];
      return { ...state, children, nodes };
    });
    await Promise.all(touched.parents.map((parent) => relist(parent)));
    throw error;
  }
}

const withNode = (id: string, patch: Partial<NodeSummary>) => (state: TreeState) =>
  state.nodes[id] ? { ...state, nodes: { ...state.nodes, [id]: { ...state.nodes[id], ...patch } } } : state;

const merged = (node: NodeSummary) => (state: TreeState) => withNode(node.id, node)(state);

export async function renameNode(notes: NotesService, id: NodeId, title: string, options: ActionOptions = {}) {
  const node = getNode(id);
  if (!node) return;
  const next = title.trim();
  if (next === node.title) return;
  const saved = await optimistic({ parents: [], nodes: [id] }, withNode(id, { title: next }), () =>
    notes.rename(id, title),
  );
  treeStore.set(merged(saved));
  if (options.record === false) return;
  recordUndo({
    undone: t('tree.undo.renamed', { title: titleOf(node) }),
    redone: t('tree.undo.renamedAgain', { title: titleOf(saved) }),
    undo: (service) => renameNode(service, id, node.title, { record: false }),
    redo: (service) => renameNode(service, id, next, { record: false }),
  });
}

export async function colorNode(notes: NotesService, id: NodeId, color: ChipColor | null, options: ActionOptions = {}) {
  const node = getNode(id);
  if (!node || node.kind === 'page' || node.color === color) return;
  const saved = await optimistic({ parents: [], nodes: [id] }, withNode(id, { color }), () =>
    notes.setColor(id, color),
  );
  treeStore.set(merged(saved));
  if (options.record === false) return;
  const title = titleOf(node);
  recordUndo({
    undone: t('tree.undo.colored', { title }),
    redone: t('tree.undo.coloredAgain', { title }),
    undo: (service) => colorNode(service, id, node.color, { record: false }),
    redo: (service) => colorNode(service, id, color, { record: false }),
  });
}

/** A page and the subpages right after it, or a container alone, in the store's order. */
export function blockOf(state: TreeState, id: NodeId): NodeId[] {
  const node = state.nodes[id];
  if (!node || node.kind !== 'page') return [id];
  const list = state.children[keyOf(node.parentId)] ?? [id];
  const start = list.indexOf(id);
  let end = start + 1;
  while (end < list.length && (state.nodes[list[end]]?.pageLevel ?? 0) > node.pageLevel) end += 1;
  return start === -1 ? [id] : list.slice(start, end);
}

/** Where a block sits now, so an undo can put it back. */
interface Origin {
  readonly id: NodeId;
  readonly parentId: NodeId | null;
  readonly beforeId: NodeId | null;
  readonly level: PageLevel;
}

function originOf(state: TreeState, id: NodeId, moving: ReadonlySet<string>): Origin {
  const node = state.nodes[id];
  const list = state.children[keyOf(node.parentId)] ?? [];
  const block = blockOf(state, id);
  const after = list.slice(list.indexOf(block[block.length - 1]) + 1).find((other) => !moving.has(other));
  return { id, parentId: node.parentId, beforeId: after ?? null, level: node.pageLevel };
}

/** The store with blocks taken from their parents and put before `beforeId`, levels unchanged. */
function locallyMoved(state: TreeState, blocks: readonly NodeId[][], placement: Placement): TreeState {
  const moved = new Set(blocks.flat());
  const children: Record<string, readonly NodeId[]> = { ...state.children };
  for (const id of moved) {
    const key = keyOf(state.nodes[id]?.parentId ?? null);
    if (children[key]?.includes(id)) children[key] = children[key].filter((other) => other !== id);
  }
  const key = keyOf(placement.parentId);
  const nodes = { ...state.nodes };
  for (const block of blocks) for (const id of block) nodes[id] = { ...nodes[id], parentId: placement.parentId };
  if (children[key]) {
    const list = children[key];
    const at = placement.beforeId && list.includes(placement.beforeId) ? list.indexOf(placement.beforeId) : list.length;
    children[key] = [...list.slice(0, at), ...blocks.flat(), ...list.slice(at)];
  }
  return { ...state, nodes, children };
}

export async function moveNodes(
  notes: NotesService,
  ids: readonly NodeId[],
  placement: Placement,
  options: ActionOptions = {},
) {
  const state = treeStore.get();
  const known = ids.filter((id) => state.nodes[id]);
  if (known.length === 0) return;
  const moving = new Set(known.flatMap((id) => blockOf(state, id)));
  const origins = known.map((id) => originOf(state, id, moving));
  const blocks = known.map((id) => blockOf(state, id));
  const parents = [...new Set([...origins.map((origin) => origin.parentId), placement.parentId])];
  await optimistic(
    { parents, nodes: [...moving] },
    (current) => locallyMoved(current, blocks, placement),
    () => notes.move(known, placement),
  );
  if (options.record === false) return;
  const title = titleOf(state.nodes[known[0]]);
  recordUndo({
    undone: t('tree.undo.moved', { title }),
    redone: t('tree.undo.movedAgain', { title }),
    undo: (service) => putBack(service, origins),
    redo: (service) => moveNodes(service, known, placement, { record: false }),
  });
}

/** Moves blocks back where they were, last first, and restores page levels the move changed. */
async function putBack(notes: NotesService, origins: readonly Origin[]): Promise<void> {
  for (const origin of [...origins].reverse()) {
    const siblings = childrenOf(treeStore.get(), origin.parentId).map((node) => node.id);
    const beforeId = origin.beforeId && siblings.includes(origin.beforeId) ? origin.beforeId : null;
    await moveNodes(notes, [origin.id], { parentId: origin.parentId, beforeId }, { record: false });
    const now = getNode(origin.id);
    if (now?.kind === 'page' && now.pageLevel !== origin.level) {
      await setLevel(notes, origin.id, origin.level, { record: false });
    }
  }
}

export async function setLevel(notes: NotesService, id: NodeId, level: PageLevel, options: ActionOptions = {}) {
  const state = treeStore.get();
  const node = state.nodes[id];
  if (!node || node.kind !== 'page' || node.pageLevel === level) return;
  const shift = level - node.pageLevel;
  const block = blockOf(state, id);
  const local = (current: TreeState) => {
    const nodes = { ...current.nodes };
    for (const member of block) {
      if (nodes[member])
        nodes[member] = { ...nodes[member], pageLevel: (nodes[member].pageLevel + shift) as PageLevel };
    }
    return { ...current, nodes };
  };
  await optimistic({ parents: [node.parentId], nodes: block }, local, () => notes.setPageLevel([id], level));
  if (options.record === false) return;
  const title = titleOf(node);
  recordUndo({
    undone: t('tree.undo.moved', { title }),
    redone: t('tree.undo.movedAgain', { title }),
    undo: (service) => setLevel(service, id, node.pageLevel, { record: false }),
    redo: (service) => setLevel(service, id, level, { record: false }),
  });
}

/** Moves nodes to Trash. Resolves with the receipt, which Undo passes to restoreReceipt. */
export async function trashNodes(notes: NotesService, ids: readonly NodeId[], options: ActionOptions = {}) {
  const state = treeStore.get();
  const known = ids.filter((id) => state.nodes[id]);
  if (known.length === 0) return null;
  const blocks = known.flatMap((id) => blockOf(state, id));
  const parents = [...new Set(known.map((id) => state.nodes[id].parentId))];
  const receipt = await optimistic(
    { parents, nodes: blocks },
    (current) => withoutNodes(current, blocks),
    () => notes.trash(known),
  );
  if (options.record !== false) recordTrash(known, receipt, titleOf(state.nodes[known[0]]));
  return receipt;
}

function recordTrash(ids: readonly NodeId[], first: TrashReceipt, title: string): void {
  let receipt = first;
  recordUndo({
    undone: t('tree.undo.restored', { title }),
    redone: t('tree.undo.trashedAgain', { title }),
    undo: async (service) => void (await restoreReceipt(service, receipt)),
    redo: async (service) => {
      receipt = (await trashNodes(service, ids, { record: false })) ?? receipt;
    },
  });
}

/** Puts a trash call's items back. The service's events re-list the parents they return to. */
export async function restoreReceipt(notes: NotesService, receipt: TrashReceipt): Promise<readonly NodeSummary[]> {
  const restored = await notes.restore(receipt.id);
  const parents = new Set(restored.map((node) => node.parentId));
  await Promise.all([...parents].map((parent) => relist(parent)));
  return restored;
}
