// Loading the tree (ARCHITECTURE.md section 13.1): the first loadInitial, started before React renders, then the
// children of each parent as it opens. Service events re-list the parents they name, and applying one twice
// changes nothing, so the store handles echoes of its own changes without flicker.

import { getLocation } from '../../app/location';
import { initialTree, pathOf } from '../../services/notes';
import type { InitialTree, NodeId, NotesEvent, NotesService } from '../../services/notes';
import { sessionStore, setExpanded } from '../../state/session';
import { createsSettled, INITIAL_TREE, keyOf, mergeNodes, ROOT, treeStore, withChildren, withoutNodes } from './store';

let bound: NotesService | null = null;
let unwatch: (() => void) | null = null;

/** The service the tree runs on, once a pane has started it. */
export function treeNotes(): NotesService | null {
  return bound;
}

/** A section inside section groups isn't reached by the location's ids alone, so walk up to its notebook. */
async function groupsAbove(notes: NotesService, sectionId: NodeId): Promise<NodeId[]> {
  const chain: NodeId[] = [];
  let at = (await notes.get(sectionId))?.parentId ?? null;
  while (at !== null) {
    const node = await notes.get(at);
    if (!node || node.kind === 'notebook') break;
    chain.unshift(node.id);
    at = node.parentId;
  }
  return chain;
}

function applyInitial(tree: InitialTree): void {
  treeStore.set((state) => {
    let next: typeof state = { ...state, status: 'ready', library: tree.library };
    next = withChildren(next, null, tree.notebooks);
    for (const [parentId, list] of Object.entries(tree.children)) next = withChildren(next, parentId as NodeId, list);
    if (tree.page) next = { ...next, nodes: mergeNodes(next.nodes, [tree.page]) };
    return next;
  });
}

/** Opens every container along the path, and the first notebook when nothing is open yet. */
function expandAlong(path: readonly NodeId[]): void {
  const containers = path.filter(
    (id) => treeStore.get().nodes[id]?.kind !== 'page' && treeStore.get().nodes[id]?.kind !== 'section',
  );
  const expanded = sessionStore.get().expanded;
  const first = treeStore.get().children[ROOT]?.[0];
  const wanted = containers.length === 0 && expanded.length === 0 && first ? [first] : containers;
  const missing = wanted.filter((id) => !expanded.includes(id));
  if (missing.length) setExpanded([...expanded, ...missing]);
}

async function loadAlongLocation(notes: NotesService, tree: InitialTree): Promise<void> {
  const location = getLocation();
  const sectionId = location.view === 'workspace' ? location.sectionId : null;
  let path = tree.resolvedPath;
  if (sectionId && !path.includes(sectionId) && path.length === 1) {
    const groups = await groupsAbove(notes, sectionId).catch(() => []);
    const fuller = await notes.loadInitial([path[0], ...groups, ...pathOf(location).slice(1)]).catch(() => null);
    if (fuller) {
      applyInitial(fuller);
      path = fuller.resolvedPath;
    }
  }
  expandAlong(path);
  await loadExpanded();
}

/** Binds the tree to a service and loads it. Safe to call again with the same service. */
export async function startTree(notes: NotesService): Promise<void> {
  if (bound === notes) return;
  unwatch?.();
  bound = notes;
  unwatch = notes.watch(applyEvent);
  treeStore.set({ ...INITIAL_TREE, status: 'loading', saveStatus: notes.saveStatus() });
  try {
    const tree = await initialTree(notes);
    if (bound !== notes) return;
    applyInitial(tree);
    await loadAlongLocation(notes, tree);
  } catch {
    if (bound === notes) treeStore.set((state) => ({ ...state, status: 'error' }));
  }
}

/** Forgets the service, for tests. */
export function stopTree(): void {
  unwatch?.();
  unwatch = null;
  bound = null;
}

const inFlight = new Map<string, { again: boolean; done: Promise<void> }>();

async function listUntilSettled(notes: NotesService, parentId: NodeId | null, entry: { again: boolean }) {
  while (entry.again) {
    entry.again = false;
    await createsSettled(parentId);
    const list = await (parentId === null ? notes.listNotebooks() : notes.listChildren(parentId)).catch(() => null);
    if (bound !== notes) return;
    if (list) treeStore.set((state) => withChildren(state, parentId, list));
    else treeStore.set((state) => withoutNodes(state, parentId ? [parentId] : []));
  }
}

/**
 * Lists a parent's children from the service and merges them. Calls for one parent coalesce: a call while a
 * listing runs asks for one more listing and waits for it.
 */
export function relist(parentId: NodeId | null): Promise<void> {
  const notes = bound;
  const key = keyOf(parentId);
  const running = inFlight.get(key);
  if (!notes) return Promise.resolve();
  if (running) {
    running.again = true;
    return running.done;
  }
  const entry = { again: true, done: Promise.resolve() };
  entry.done = listUntilSettled(notes, parentId, entry).finally(() => inFlight.delete(key));
  inFlight.set(key, entry);
  return entry.done;
}

const loads = new Map<string, Promise<void>>();

/**
 * Loads a container's children once, marking it as loading meanwhile. A second call while it loads waits for the
 * same load.
 */
export function ensureChildren(parentId: NodeId): Promise<void> {
  const state = treeStore.get();
  const node = state.nodes[parentId];
  const running = loads.get(parentId);
  if (running) return running;
  if (!node || node.kind === 'page' || parentId in state.children) return Promise.resolve();
  treeStore.set((current) => ({ ...current, loading: { ...current.loading, [parentId]: true } }));
  const load = relist(parentId).finally(() => {
    loads.delete(parentId);
    treeStore.set((current) => {
      if (!(parentId in current.loading)) return current;
      const { [parentId]: _gone, ...loading } = current.loading;
      return { ...current, loading };
    });
  });
  loads.set(parentId, load);
  return load;
}

/**
 * Loads the children of every open container. A group inside an open notebook is known only once the notebook's
 * children are in, so this goes level by level until no open container is left to load.
 */
export async function loadExpanded(): Promise<void> {
  const tried = new Set<string>();
  for (;;) {
    const state = treeStore.get();
    const ready = sessionStore
      .get()
      .expanded.filter((id) => !tried.has(id) && state.nodes[id as NodeId] !== undefined);
    if (ready.length === 0) return;
    for (const id of ready) tried.add(id);
    await Promise.all(ready.map((id) => ensureChildren(id as NodeId)));
  }
}

async function reset(notes: NotesService): Promise<void> {
  const tree = await notes.loadInitial(pathOf(getLocation())).catch(() => null);
  if (!tree || bound !== notes) return;
  treeStore.set((state) => ({ ...state, nodes: {}, children: {} }));
  applyInitial(tree);
  await loadExpanded();
}

export function applyEvent(event: NotesEvent): void {
  switch (event.type) {
    case 'upserted':
      treeStore.set((state) => {
        const nodes = mergeNodes(state.nodes, event.nodes);
        return nodes === state.nodes ? state : { ...state, nodes };
      });
      return;
    case 'removed':
      treeStore.set((state) => withoutNodes(state, event.ids));
      return;
    case 'childrenChanged':
      if (keyOf(event.parentId) in treeStore.get().children) void relist(event.parentId);
      return;
    case 'status':
      treeStore.set((state) => (state.saveStatus === event.status ? state : { ...state, saveStatus: event.status }));
      return;
    case 'reset':
      if (bound) void reset(bound);
  }
}
