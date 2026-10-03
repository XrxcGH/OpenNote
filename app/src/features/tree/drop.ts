// Where a dragged row would land (ARCHITECTURE.md section 13.6), without the DOM. Rows have fixed heights, so the
// row under the pointer comes from arithmetic: the top quarter of a row means "before", the bottom quarter
// "after", and the middle "into", when the kinds allow it. Otherwise the middle splits into before and after.

import type { NodeId, NodeSummary, Placement } from '../../services/notes';
import { blockOf } from './actions';
import { canHold } from './destinations';
import type { Row } from './rows';
import { keyOf } from './store';
import type { TreeState } from './store';

export type Zone = 'before' | 'after' | 'into';

export interface Geometry {
  /** The top of the first row, in the same coordinates as the pointer. */
  readonly top: number;
  readonly rowHeight: number;
  readonly count: number;
}

/** The row under a pointer and where in it, as a fraction from 0 (top) to 1 (bottom). Clamped to the list. */
export function rowAt(y: number, geometry: Geometry): { index: number; fraction: number } | null {
  const { top, rowHeight, count } = geometry;
  if (count === 0 || rowHeight <= 0) return null;
  const at = (y - top) / rowHeight;
  if (at < 0) return { index: 0, fraction: 0 };
  if (at >= count) return { index: count - 1, fraction: 1 };
  return { index: Math.floor(at), fraction: at - Math.floor(at) };
}

export interface Drop {
  readonly placement: Placement;
  /** The row that shows the drop, and how. */
  readonly rowId: NodeId;
  readonly zone: Zone;
  /** The container the node lands in, for the label and the toast. */
  readonly target: NodeSummary;
}

/** The item after a node's block in its parent's list, or null at the end. */
function afterBlock(state: TreeState, node: NodeSummary): NodeId | null {
  const list = state.children[keyOf(node.parentId)] ?? [];
  const block = blockOf(state, node.id);
  return list[list.indexOf(block[block.length - 1]) + 1] ?? null;
}

function into(state: TreeState, dragged: NodeSummary, row: Row): Drop | null {
  if (!canHold(state, dragged, row.node)) return null;
  return { placement: { parentId: row.node.id, beforeId: null }, rowId: row.id, zone: 'into', target: row.node };
}

function beside(state: TreeState, dragged: NodeSummary, row: Row, zone: 'before' | 'after'): Drop | null {
  const parent = row.node.parentId ? state.nodes[row.node.parentId] : null;
  if (row.node.parentId && !parent) return null;
  if (!canHold(state, dragged, parent)) return null;
  const block = blockOf(state, dragged.id);
  if (block.includes(row.node.id)) return null;
  const beforeId = zone === 'before' ? row.node.id : afterBlock(state, row.node);
  if (beforeId !== null && block.includes(beforeId)) return null;
  const target = parent ?? row.node;
  return { placement: { parentId: row.node.parentId, beforeId }, rowId: row.id, zone, target };
}

/** Whether the drop puts the node where it already is. */
export function isNoop(state: TreeState, dragged: NodeSummary, drop: Drop): boolean {
  if (drop.placement.parentId !== dragged.parentId) return false;
  const list = state.children[keyOf(dragged.parentId)] ?? [];
  const block = blockOf(state, dragged.id);
  return drop.placement.beforeId === (list[list.indexOf(block[block.length - 1]) + 1] ?? null);
}

/**
 * The drop for a pointer over a row, or null when the node can't go there. The middle of a row means "into" when
 * the row can hold the node, else the nearer of before and after.
 */
export function resolveDrop(state: TreeState, dragged: NodeSummary, row: Row, fraction: number): Drop | null {
  const edge: 'before' | 'after' = fraction < 0.5 ? 'before' : 'after';
  let drop: Drop | null;
  if (fraction >= 0.25 && fraction <= 0.75) drop = into(state, dragged, row) ?? beside(state, dragged, row, edge);
  else drop = beside(state, dragged, row, edge);
  return drop && !isNoop(state, dragged, drop) ? drop : null;
}
