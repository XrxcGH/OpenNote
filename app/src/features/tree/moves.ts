// Moving among siblings and changing a page's level (ARCHITECTURE.md section 13.6), without the store or the
// service: given the store's state, what a step up, or down would do. A page's siblings are the pages at its
// level under the same parent page, and a page moves with its subpages.

import type { NodeId, PageLevel, Placement } from '../../services/notes';
import { NOTES_LIMITS } from '../../services/notes';
import { blockOf } from './actions';
import { keyOf } from './store';
import type { TreeState } from './store';

export interface Step {
  readonly placement: Placement;
  /** The place among the siblings after the move, from 1. */
  readonly position: number;
  readonly count: number;
}

/** The ids that share a node's parent, in order: for a page, the pages at its level under the same page. */
export function siblingsOf(state: TreeState, id: NodeId): NodeId[] {
  const node = state.nodes[id];
  if (!node) return [];
  const list = state.children[keyOf(node.parentId)] ?? [];
  if (node.kind !== 'page') return [...list];
  const at = list.indexOf(id);
  if (at === -1) return [id];
  const level = node.pageLevel;
  let start = at;
  while (start > 0 && (state.nodes[list[start - 1]]?.pageLevel ?? 0) >= level) start -= 1;
  let end = at + 1;
  while (end < list.length && (state.nodes[list[end]]?.pageLevel ?? 0) >= level) end += 1;
  return list.slice(start, end).filter((other) => state.nodes[other]?.pageLevel === level);
}

/** Where a node goes when it moves one step among its siblings, or null at the end it is already at. */
export function stepOf(state: TreeState, id: NodeId, direction: 'up' | 'down'): Step | null {
  const node = state.nodes[id];
  const siblings = siblingsOf(state, id);
  const at = siblings.indexOf(id);
  const to = direction === 'up' ? at - 1 : at + 1;
  if (!node || at === -1 || to < 0 || to >= siblings.length) return null;
  const list = state.children[keyOf(node.parentId)] ?? [];
  let beforeId: NodeId | null;
  if (direction === 'up') {
    beforeId = siblings[to];
  } else if (node.kind === 'page') {
    const block = blockOf(state, siblings[to]);
    beforeId = list[list.indexOf(block[block.length - 1]) + 1] ?? null;
  } else {
    beforeId = siblings[to + 1] ?? null;
  }
  return { placement: { parentId: node.parentId, beforeId }, position: to + 1, count: siblings.length };
}

/** The page level after making a page a subpage (1) or promoting it (-1), or null when that can't be done. */
export function levelAfter(state: TreeState, id: NodeId, change: 1 | -1): PageLevel | null {
  const node = state.nodes[id];
  if (!node || node.kind !== 'page') return null;
  const level = node.pageLevel + change;
  if (level < 0 || level > NOTES_LIMITS.pageLevel) return null;
  if (change === -1) return level as PageLevel;
  const list = state.children[keyOf(node.parentId)] ?? [];
  const before = state.nodes[list[list.indexOf(id) - 1]];
  if (!before || before.pageLevel < node.pageLevel) return null;
  const deepest = Math.max(...blockOf(state, id).map((member) => state.nodes[member]?.pageLevel ?? 0));
  return deepest + 1 > NOTES_LIMITS.pageLevel ? null : (level as PageLevel);
}
