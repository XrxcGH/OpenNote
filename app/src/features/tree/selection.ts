// Selection lives in the location (ARCHITECTURE.md section 13.1), and it follows focus. The row shows as selected
// at once, and the section's pages or the page open after arrow keys pause for 100 ms. So holding an arrow key
// doesn't load every page. A click, a tap, or Enter opens at once and adds a history entry; selection
// that follows arrows replaces the current entry.

import { getLocation, navigate } from '../../app/location';
import type { Location } from '../../app/location';
import type { NodeId } from '../../services/notes';
import { recordRecentPage, sessionStore } from '../../state/session';
import { tokens } from '../../theme/tokens';
import { ensureChildren } from './load';
import { notebookOf, treeOf, treeStore } from './store';
import type { TreeId } from './store';

export type SelectHow = 'now' | 'follow';

type Workspace = Extract<Location, { view: 'workspace' }>;

let timer: ReturnType<typeof setTimeout> | null = null;

function remember(sectionId: NodeId, pageId: NodeId): void {
  sessionStore.set((state) =>
    state.lastPageBySection[sectionId] === pageId
      ? state
      : { ...state, lastPageBySection: { ...state.lastPageBySection, [sectionId]: pageId } },
  );
  recordRecentPage(pageId);
}

/** The location that shows a section or a page. */
export function locationFor(id: NodeId): Workspace | null {
  const state = treeStore.get();
  const node = state.nodes[id];
  if (!node || node.kind === 'notebook' || node.kind === 'sectionGroup') return null;
  const sectionId = node.kind === 'page' ? node.parentId : node.id;
  if (!sectionId) return null;
  const remembered = sessionStore.get().lastPageBySection[sectionId] as NodeId | undefined;
  const known = remembered && state.nodes[remembered]?.parentId === sectionId ? remembered : null;
  return {
    view: 'workspace',
    notebookId: notebookOf(state, sectionId),
    sectionId,
    pageId: node.kind === 'page' ? node.id : known,
  };
}

function setPending(tree: TreeId, id: NodeId | null): void {
  treeStore.set((state) =>
    state.pending[tree] === id ? state : { ...state, pending: { ...state.pending, [tree]: id } },
  );
}

function open(to: Workspace, replace: boolean): void {
  navigate(to, { replace, focus: 'keep' });
  if (to.sectionId) void openFirstPage(to.sectionId);
  if (to.sectionId && to.pageId) remember(to.sectionId, to.pageId);
}

/** Once a section's pages are loaded, a section with none chosen opens its first page. */
async function openFirstPage(sectionId: NodeId): Promise<void> {
  await ensureChildren(sectionId);
  const location = getLocation();
  if (location.view !== 'workspace' || location.sectionId !== sectionId || location.pageId) return;
  const first = treeStore.get().children[sectionId]?.[0];
  if (first) {
    navigate({ ...location, pageId: first }, { replace: true, focus: 'keep' });
    remember(sectionId, first);
  }
}

/** Selects a section or a page: at once, or after the arrow keys pause. */
export function select(id: NodeId, how: SelectHow): void {
  const to = locationFor(id);
  if (!to) return;
  const tree = treeOf(treeStore.get().nodes[id]);
  if (timer) clearTimeout(timer);
  timer = null;
  if (how === 'now') {
    setPending(tree, null);
    open(to, false);
    return;
  }
  setPending(tree, id);
  timer = setTimeout(() => {
    timer = null;
    setPending(tree, null);
    open(to, true);
  }, tokens.interaction.pageOpenDebounceMs);
}

/** Opens the location's section and page, for example after a delete moves the selection. */
export function showLocation(to: Workspace, replace = true): void {
  open(to, replace);
}

/** The selected row of a tree: the pending row while the debounce runs, otherwise what the location shows. */
export function selectedIn(tree: TreeId, state = treeStore.get(), location = getLocation()): NodeId | null {
  if (state.pending[tree]) return state.pending[tree];
  if (location.view !== 'workspace') return null;
  return tree === 'pages' ? location.pageId : location.sectionId;
}
