// Opening and closing rows, and what Enter does (ARCHITECTURE.md section 13.3). Open notebooks and section groups
// are saved in the session, so a relaunch shows the same tree; folded pages are not saved.

import type { NodeId } from '../../services/notes';
import { focusRegion } from '../../shell/regions';
import { sessionStore, setExpanded } from '../../state/session';
import { ensureChildren } from './load';
import type { Row } from './rows';
import { select } from './selection';
import { requestFocus, treeStore } from './store';
import type { TreeId } from './store';

/** Opens or closes rows: containers in the notebooks tree, pages with subpages in the pages tree. */
export function setOpen(tree: TreeId, ids: readonly NodeId[], open: boolean): void {
  if (tree === 'pages') {
    treeStore.set((state) => {
      const folded = { ...state.folded };
      for (const id of ids) {
        if (open) delete folded[id];
        else folded[id] = true;
      }
      return { ...state, folded };
    });
    return;
  }
  const expanded = sessionStore.get().expanded;
  setExpanded(
    open
      ? [...expanded, ...ids.filter((id) => !expanded.includes(id))]
      : expanded.filter((id) => !ids.includes(id as NodeId)),
  );
  if (open) for (const id of ids) void ensureChildren(id);
}

/** Opens the containers above a node, so its row shows, for example after a move or a restore. */
export function revealNode(id: NodeId): void {
  const state = treeStore.get();
  const above: NodeId[] = [];
  for (let at = state.nodes[id]?.parentId ?? null; at !== null; at = state.nodes[at]?.parentId ?? null) {
    if (state.nodes[at]?.kind !== 'section') above.push(at);
  }
  if (above.length) setOpen('notebooks', above, true);
}

/** Enter: a section opens and focus moves to its first page; a page opens and focus moves to its heading. */
export async function openRow(tree: TreeId, row: Row): Promise<void> {
  const { node } = row;
  if (node.kind === 'notebook' || node.kind === 'sectionGroup') {
    if (row.expanded !== undefined) setOpen(tree, [node.id], !row.expanded);
    return;
  }
  select(node.id, 'now');
  if (node.kind === 'page') {
    focusRegion('page', 'main');
    return;
  }
  await ensureChildren(node.id);
  const first = treeStore.get().children[node.id]?.[0];
  if (first) requestFocus('pages', first);
}
