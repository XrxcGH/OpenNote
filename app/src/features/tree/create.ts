// Creating items (ARCHITECTURE.md section 13.5). A new item appears at once, after the current one, in rename mode
// with its default title selected. It has a temporary id until the service answers, and a rename committed
// before then waits for the real id.

import type {
  CreateInput,
  NodeId,
  NodeKind,
  NodeSummary,
  NotesService,
  PageLevel,
  Placement,
} from '../../services/notes';
import { t } from '../../strings/t';
import { restoreReceipt, titleOf, trashNodes } from './actions';
import { toastError } from './errors';
import { ensureChildren } from './load';
import { aliasKey, keyOf, mergeNodes, trackCreate, treeOf, treeStore, withoutNodes } from './store';
import type { TreeState } from './store';
import { recordUndo } from './undo';

let temporary = 0;
const pending = new Map<NodeId, Promise<NodeId | null>>();

export function isTemporary(id: NodeId): boolean {
  return pending.has(id);
}

/** The real id for an item, waiting for its create call when it is still temporary. Null when that failed. */
export async function realId(id: NodeId): Promise<NodeId | null> {
  return pending.get(id) ?? id;
}

export interface NewItem {
  readonly kind: NodeKind;
  readonly placement: Placement;
  readonly pageLevel?: PageLevel;
}

function placeholder(item: NewItem, id: NodeId, title: string): NodeSummary {
  const now = new Date().toISOString();
  return {
    id,
    kind: item.kind,
    parentId: item.placement.parentId,
    title,
    color: null,
    pageLevel: item.kind === 'page' ? (item.pageLevel ?? 0) : 0,
    childCount: 0,
    created: now,
    modified: now,
    readOnly: false,
  };
}

function inserted(state: TreeState, node: NodeSummary, beforeId: NodeId | null): TreeState {
  const key = keyOf(node.parentId);
  const list = state.children[key] ?? [];
  const at = beforeId && list.includes(beforeId) ? list.indexOf(beforeId) : list.length;
  const tree = treeOf(node);
  return {
    ...state,
    nodes: { ...state.nodes, [node.id]: node },
    children: { ...state.children, [key]: [...list.slice(0, at), node.id, ...list.slice(at)] },
    focus: { ...state.focus, [tree]: node.id },
    renaming: { id: node.id, draft: node.title, error: null, isNew: true },
  };
}

/** Swaps the temporary id for the real one everywhere the store holds it. */
function swapped(state: TreeState, from: NodeId, node: NodeSummary): TreeState {
  const swap = (id: NodeId | null) => (id === from ? node.id : id);
  const { [from]: _temp, ...nodes } = state.nodes;
  const replace = (list: readonly NodeId[]) =>
    list.includes(node.id) ? list.filter((id) => id !== from) : list.map((id) => swap(id) as NodeId);
  const children = Object.fromEntries(
    Object.entries(state.children).map(([key, list]) => [key, list.includes(from) ? replace(list) : list]),
  );
  return {
    ...state,
    nodes: mergeNodes(nodes, [node]),
    children,
    focus: { notebooks: swap(state.focus.notebooks), pages: swap(state.focus.pages) },
    renaming: state.renaming?.id === from ? { ...state.renaming, id: node.id } : state.renaming,
  };
}

/** Adds an item in rename mode. Resolves with the created item, or null when the service refused it. */
export async function createItem(notes: NotesService, item: NewItem): Promise<NodeSummary | null> {
  const parentId = item.placement.parentId;
  if (parentId) await ensureChildren(parentId);
  const title = t(`tree.untitled.${item.kind}`);
  const temp = `tmp-${(temporary += 1)}` as NodeId;
  const input: CreateInput = { ...item, title };
  let answered: (id: NodeId | null) => void = () => {};
  pending.set(temp, new Promise((resolve) => (answered = resolve)));
  // Tracked before the call, because the service may re-list the parent before the call returns.
  trackCreate(parentId, pending.get(temp) as Promise<NodeId | null>);
  treeStore.set((state) => inserted(state, placeholder(item, temp, title), item.placement.beforeId));
  try {
    const node = await notes.create(input);
    aliasKey(node.id, temp);
    treeStore.set((state) => swapped(state, temp, node));
    answered(node.id);
    recordCreate(node);
    return node;
  } catch (error) {
    treeStore.set((state) => ({ ...withoutNodes(state, [temp]), renaming: null }));
    answered(null);
    toastError(error, title);
    return null;
  } finally {
    pending.delete(temp);
  }
}

function recordCreate(node: NodeSummary): void {
  let receipt: Awaited<ReturnType<typeof trashNodes>> = null;
  const title = () => titleOf(treeStore.get().nodes[node.id] ?? node);
  recordUndo({
    get undone() {
      return t('tree.undo.created', { title: title() });
    },
    get redone() {
      return t('tree.undo.recreated', { title: title() });
    },
    undo: async (service) => void (receipt = await trashNodes(service, [node.id], { record: false })),
    redo: async (service) => void (receipt && (await restoreReceipt(service, receipt))),
  });
}
