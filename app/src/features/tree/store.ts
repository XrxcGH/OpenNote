// The tree store (ARCHITECTURE.md sections 5.2 and 13.1). It holds nodes by id and each loaded parent's children
// in display order. It also holds which parents are loading, folded pages, the focused row of each tree, and the
// selection shown while the page-open debounce runs. Inline rename and the save status live here too. The notes
// service is the source of truth; the store merges what it returns by id, so unchanged rows keep their objects and
// don't re-render.

import type { LibraryInfo, NodeId, NodeSummary, SaveStatus } from '../../services/notes';
import { createStore } from '../../state/store';

export type TreeId = 'notebooks' | 'pages';

/** The notebooks' key in `children`. */
export const ROOT = '';

export interface Renaming {
  readonly id: NodeId;
  readonly draft: string;
  readonly error: string | null;
  /** A new item keeps its default name on Escape. */
  readonly isNew: boolean;
}

export interface TreeState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly library: LibraryInfo | null;
  readonly nodes: Readonly<Record<string, NodeSummary>>;
  /** Children in display order, keyed by parent id, or ROOT for the notebooks. A key means the parent is loaded. */
  readonly children: Readonly<Record<string, readonly NodeId[]>>;
  readonly loading: Readonly<Record<string, true>>;
  /** Pages whose subpages are folded away. Not saved. */
  readonly folded: Readonly<Record<string, true>>;
  /** The row with tabindex 0 in each tree. */
  readonly focus: Readonly<Record<TreeId, NodeId | null>>;
  /** The row shown as selected while the page-open debounce runs. */
  readonly pending: Readonly<Record<TreeId, NodeId | null>>;
  readonly renaming: Renaming | null;
  readonly saveStatus: SaveStatus;
  /** A row that should take DOM focus once it renders. `seq` changes with each request. */
  readonly focusRequest: { readonly tree: TreeId; readonly id: NodeId; readonly seq: number } | null;
}

export const INITIAL_TREE: TreeState = {
  status: 'idle',
  library: null,
  nodes: {},
  children: {},
  loading: {},
  folded: {},
  focus: { notebooks: null, pages: null },
  pending: { notebooks: null, pages: null },
  renaming: null,
  saveStatus: 'saved',
  focusRequest: null,
};

export const treeStore = createStore<TreeState>(INITIAL_TREE, 'tree');

export const keyOf = (parentId: NodeId | null) => parentId ?? ROOT;

function sameNode(a: NodeSummary, b: NodeSummary): boolean {
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    a.parentId === b.parentId &&
    a.title === b.title &&
    a.color === b.color &&
    a.pageLevel === b.pageLevel &&
    a.childCount === b.childCount &&
    a.modified === b.modified &&
    a.readOnly === b.readOnly
  );
}

/** Nodes merged by id: an unchanged node keeps its object, and nothing changes when nothing differs. */
export function mergeNodes(nodes: TreeState['nodes'], incoming: readonly NodeSummary[]): TreeState['nodes'] {
  let next: Record<string, NodeSummary> | null = null;
  for (const node of incoming) {
    const known = nodes[node.id];
    if (known && sameNode(known, node)) continue;
    next ??= { ...nodes };
    next[node.id] = node;
  }
  return next ?? nodes;
}

const sameIds = (a: readonly string[] | undefined, b: readonly string[]) =>
  a !== undefined && a.length === b.length && a.every((id, i) => id === b[i]);

/** A parent's children from a listing, merged so an unchanged list keeps its array. */
export function withChildren(state: TreeState, parentId: NodeId | null, list: readonly NodeSummary[]): TreeState {
  const key = keyOf(parentId);
  const ids = list.map((node) => node.id);
  const nodes = mergeNodes(state.nodes, list);
  const same = sameIds(state.children[key], ids);
  const { [key]: _done, ...loading } = state.loading;
  const stillLoading = key in state.loading;
  if (same && nodes === state.nodes && !stillLoading) return state;
  return {
    ...state,
    nodes,
    children: same ? state.children : { ...state.children, [key]: ids },
    loading: stillLoading ? loading : state.loading,
  };
}

/** Every id under a node, as far as the store knows it. */
export function descendants(state: TreeState, id: string): string[] {
  return (state.children[id] ?? []).flatMap((child) => [child, ...descendants(state, child)]);
}

/** Takes nodes out: from their parents' lists, and with everything under them. */
export function withoutNodes(state: TreeState, ids: readonly string[]): TreeState {
  const gone = new Set(ids.flatMap((id) => [id, ...descendants(state, id)]));
  if (![...gone].some((id) => id in state.nodes)) return state;
  const nodes = Object.fromEntries(Object.entries(state.nodes).filter(([id]) => !gone.has(id)));
  const children = Object.fromEntries(
    Object.entries(state.children)
      .filter(([key]) => !gone.has(key))
      .map(([key, list]) => [key, list.some((id) => gone.has(id)) ? list.filter((id) => !gone.has(id)) : list]),
  );
  return { ...state, nodes, children };
}

export function getNode(id: string | null | undefined): NodeSummary | undefined {
  return id ? treeStore.get().nodes[id] : undefined;
}

/** The ancestors of a node, nearest first, as far as the store knows them. */
export function ancestors(state: TreeState, id: string): NodeSummary[] {
  const found: NodeSummary[] = [];
  for (let at = state.nodes[id]?.parentId ?? null; at !== null; at = state.nodes[at]?.parentId ?? null) {
    const node = state.nodes[at];
    if (!node) break;
    found.push(node);
  }
  return found;
}

export function notebookOf(state: TreeState, id: string): NodeId | null {
  const node = state.nodes[id];
  if (!node) return null;
  if (node.kind === 'notebook') return node.id;
  const chain = ancestors(state, id);
  return chain[chain.length - 1]?.kind === 'notebook' ? chain[chain.length - 1].id : null;
}

/** A parent's children as nodes, in order. */
export function childrenOf(state: TreeState, parentId: NodeId | null): NodeSummary[] {
  return (state.children[keyOf(parentId)] ?? []).map((id) => state.nodes[id]).filter(Boolean);
}

const creating = new Map<string, Set<Promise<unknown>>>();
const aliases = new Map<string, string>();

/** Holds back re-listing a parent until a create into it has answered, so its temporary row isn't lost. */
export function trackCreate(parentId: NodeId | null, call: Promise<unknown>): void {
  const key = keyOf(parentId);
  const calls = creating.get(key) ?? new Set();
  creating.set(key, calls);
  const settled = call.catch(() => {});
  calls.add(settled);
  void settled.then(() => calls.delete(settled));
}

export async function createsSettled(parentId: NodeId | null): Promise<void> {
  await Promise.all(creating.get(keyOf(parentId)) ?? []);
}

/** A created item keeps its temporary row's React key, so the row and its rename field don't remount. */
export function aliasKey(realId: string, temporaryId: string): void {
  aliases.set(realId, temporaryId);
}

export function rowKey(id: string): string {
  return aliases.get(id) ?? id;
}

export function setFocus(tree: TreeId, id: NodeId | null): void {
  treeStore.set((state) => (state.focus[tree] === id ? state : { ...state, focus: { ...state.focus, [tree]: id } }));
}

/** Makes a row the tree's roving row and moves DOM focus to it once it renders. */
export function requestFocus(tree: TreeId, id: NodeId): void {
  treeStore.set((state) => ({
    ...state,
    focus: { ...state.focus, [tree]: id },
    focusRequest: { tree, id, seq: (state.focusRequest?.seq ?? 0) + 1 },
  }));
}

export function treeOf(node: NodeSummary | undefined): TreeId {
  return node?.kind === 'page' ? 'pages' : 'notebooks';
}
