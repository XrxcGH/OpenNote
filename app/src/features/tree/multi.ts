// Selecting several pages or sections (docs/FEATURES.md, "Select several pages"). Ctrl-click adds or removes a row,
// Shift-click selects the range from the anchor, and Shift+Up and Shift+Down extend it from the keyboard. The
// selection lives in one tree at a time and holds only pages or only sections. The open page is still the one the
// location names; Move to, Copy to, Color, and Delete act on this set when it holds more than one row.

import type { CommandContext } from '../../commands/types';
import type { NodeId, NodeSummary } from '../../services/notes';
import { createStore } from '../../state/store';
import type { Row } from './rows';
import { getNode } from './store';
import type { TreeId } from './store';

export interface MultiState {
  readonly tree: TreeId | null;
  readonly ids: readonly NodeId[];
  /** The row a range starts from. */
  readonly anchor: NodeId | null;
}

export const EMPTY_MULTI: MultiState = { tree: null, ids: [], anchor: null };

export const multiStore = createStore<MultiState>(EMPTY_MULTI, 'treeMulti');

/** Whether a row can join a selection: pages in the pages tree, sections in the notebooks tree. */
export function selectable(node: NodeSummary): boolean {
  return node.kind === 'page' || node.kind === 'section';
}

/** The ids with one added or removed, in the order they were chosen. */
export function toggled(ids: readonly NodeId[], id: NodeId): NodeId[] {
  return ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id];
}

/** The selectable rows between two ids, both included, in tree order, of the kind of the second. */
export function rangeBetween(rows: readonly Row[], from: NodeId, to: NodeId): NodeId[] {
  const a = rows.findIndex((row) => row.id === from);
  const b = rows.findIndex((row) => row.id === to);
  if (a === -1 || b === -1) return [to];
  const [start, end] = a < b ? [a, b] : [b, a];
  const kind = rows[b].node.kind;
  return rows
    .slice(start, end + 1)
    .filter((row) => selectable(row.node) && row.node.kind === kind)
    .map((row) => row.id);
}

export function clearMulti(): void {
  if (multiStore.get().ids.length > 0) multiStore.set(EMPTY_MULTI);
}

/** Ctrl-click: adds the row (and the one that is open, the first time) or takes it out. */
export function toggleRow(tree: TreeId, row: Row, openId: NodeId | null): void {
  if (!selectable(row.node)) return;
  multiStore.set((state) => {
    const same = state.tree === tree && state.ids.length > 0;
    const open = openId && openId !== row.id && getNode(openId)?.kind === row.node.kind ? [openId] : [];
    const ids = toggled(same ? state.ids : open, row.id);
    return ids.length === 0 ? EMPTY_MULTI : { tree, ids, anchor: row.id };
  });
}

/** Shift-click: the range from the anchor (else the open row) to this row. */
export function rangeTo(tree: TreeId, rows: readonly Row[], row: Row, openId: NodeId | null): void {
  if (!selectable(row.node)) return;
  const state = multiStore.get();
  const anchor = (state.tree === tree ? state.anchor : null) ?? openId ?? row.id;
  multiStore.set({ tree, ids: rangeBetween(rows, anchor, row.id), anchor });
}

/** Shift+Up and Shift+Down: extends the range one row. Returns the row to focus, or null at the end. */
export function extendFrom(
  tree: TreeId,
  rows: readonly Row[],
  focusIndex: number,
  step: 1 | -1,
  openId: NodeId | null,
): Row | null {
  const target = rows[focusIndex + step];
  const from = rows[focusIndex];
  if (!target || !from || !selectable(target.node) || target.node.kind !== from.node.kind) return null;
  const state = multiStore.get();
  const anchor = (state.tree === tree ? state.anchor : null) ?? openId ?? from.id;
  multiStore.set({ tree, ids: rangeBetween(rows, anchor, target.id), anchor });
  return target;
}

/** The nodes of the selection when it holds two or more and the command row is in it. */
export function selectedNodes(ctx?: CommandContext, rowId?: NodeId): NodeSummary[] | null {
  const { ids } = multiStore.get();
  if (ids.length < 2) return null;
  const target = rowId ?? (ctx?.target?.kind === 'node' ? ctx.target.id : undefined);
  if (target && !ids.includes(target)) return null;
  const nodes = ids.map((id) => getNode(id)).filter((node): node is NodeSummary => node !== undefined);
  return nodes.length >= 2 ? nodes : null;
}
