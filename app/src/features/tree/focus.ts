// Where focus goes when a row leaves its list (ARCHITECTURE.md section 13.9): the next sibling, else the previous
// one, else the parent. A page's parent in the notebooks tree is its section. Never <body>.

import type { NodeId, NodeSummary } from '../../services/notes';
import { sessionStore } from '../../state/session';
import { qolStore } from '../../state/qol';
import { notebookRows, pageRows } from './rows';
import type { Row } from './rows';
import { treeOf } from './store';
import type { TreeId, TreeState } from './store';

export interface FocusTarget {
  readonly tree: TreeId;
  readonly id: NodeId;
}

/** The row that takes focus when `id` and everything under it leave `rows`, or null when nothing is left. */
export function siblingOrParent(rows: readonly Row[], id: NodeId): NodeId | null {
  const at = rows.findIndex((row) => row.id === id);
  if (at === -1) return null;
  const { level, parentId } = rows[at];
  let next = at + 1;
  while (next < rows.length && rows[next].level > level) next += 1;
  if (next < rows.length && rows[next].parentId === parentId) return rows[next].id;
  for (let i = at - 1; i >= 0; i -= 1) if (rows[i].parentId === parentId) return rows[i].id;
  return parentId;
}

function rowsAround(state: TreeState, node: NodeSummary): readonly Row[] {
  return treeOf(node) === 'pages'
    ? pageRows(state, node.parentId, qolStore.get().showArchived)
    : notebookRows(state, new Set(sessionStore.get().expanded), qolStore.get().showArchived);
}

/** The row to focus once `node` has gone from the rows the store shows now. */
export function focusTargetAfterRemoval(state: TreeState, node: NodeSummary): FocusTarget | null {
  const tree = treeOf(node);
  const id = siblingOrParent(rowsAround(state, node), node.id);
  if (id) return { tree, id };
  return node.kind === 'page' && node.parentId ? { tree: 'notebooks', id: node.parentId } : null;
}

/**
 * The row to focus once several rows have gone: the first row after the last of them that stays, else the last
 * one before the first, else the parent, as for one row. `removed` holds every id that leaves, subpages included.
 */
export function focusTargetAfterRemovals(
  state: TreeState,
  nodes: readonly NodeSummary[],
  removed: ReadonlySet<NodeId>,
): FocusTarget | null {
  const [first] = nodes;
  const rows = rowsAround(state, first);
  const gone = rows.flatMap((row, index) => (removed.has(row.id) ? [index] : []));
  if (gone.length === 0) return focusTargetAfterRemoval(state, first);
  const parentId = rows[gone[0]].parentId;
  const kept = (row: Row) => !removed.has(row.id) && row.parentId === parentId;
  const next = rows.slice(gone[gone.length - 1] + 1).find(kept);
  const before = rows.slice(0, gone[0]).findLast(kept);
  const id = (next ?? before)?.id ?? parentId;
  if (id) return { tree: treeOf(first), id };
  return first.kind === 'page' && first.parentId ? { tree: 'notebooks', id: first.parentId } : null;
}
