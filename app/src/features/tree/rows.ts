// The visible rows of each tree, flat, with their ARIA level, position, and set size (ARCHITECTURE.md section
// 13.2). Flat rows let the tree window its rows. Both builders are memoized on the store fields they read, so
// focus and selection changes don't rebuild the list.

import type { NodeId, NodeSummary } from '../../services/notes';
import { ROOT } from './store';
import type { TreeState } from './store';

export type RowSource = Pick<TreeState, 'nodes' | 'children' | 'folded'>;

export interface Row {
  readonly id: NodeId;
  readonly node: NodeSummary;
  /** aria-level, from 1. */
  readonly level: number;
  readonly posinset: number;
  readonly setsize: number;
  /** Has children to show or hide; undefined for rows that can't. */
  readonly expanded?: boolean;
  /** The row's parent row, for Left and for focus after a delete. */
  readonly parentId: NodeId | null;
}

function hasChildren(state: RowSource, node: NodeSummary): boolean {
  const loaded = state.children[node.id];
  return loaded ? loaded.length > 0 : node.childCount > 0;
}

/** Notebooks, section groups, and sections, with the open containers' children under them. */
export function notebookRows(state: RowSource, expanded: ReadonlySet<string>, showArchived = true): Row[] {
  const rows: Row[] = [];
  const walk = (parent: string, level: number, parentId: NodeId | null) => {
    const ids = (state.children[parent] ?? []).filter(
      (id) => state.nodes[id] && (showArchived || !state.nodes[id].archived),
    );
    ids.forEach((id, i) => {
      const node = state.nodes[id];
      const container = node.kind !== 'section';
      const open = container && expanded.has(id);
      const canOpen = container && hasChildren(state, node);
      rows.push({
        id,
        node,
        level,
        posinset: i + 1,
        setsize: ids.length,
        expanded: canOpen ? open : undefined,
        parentId,
      });
      if (open) walk(id, level + 1, id);
    });
  };
  walk(ROOT, 1, null);
  return rows;
}

/** The pages with archived ones left out, and their subpages with them, unless archived items are shown. */
function visiblePages(pages: readonly NodeSummary[], showArchived: boolean): NodeSummary[] {
  if (showArchived) return [...pages];
  const kept: NodeSummary[] = [];
  let skipBelow = Infinity;
  for (const page of pages) {
    if (page.pageLevel > skipBelow) continue;
    skipBelow = page.archived ? page.pageLevel : Infinity;
    if (!page.archived) kept.push(page);
  }
  return kept;
}

/** A section's pages. Each subpage's parent is the nearest page before it one level up. */
export function pageRows(state: RowSource, sectionId: NodeId | null, showArchived = true): Row[] {
  if (!sectionId) return [];
  const pages = visiblePages(
    (state.children[sectionId] ?? []).map((id) => state.nodes[id]).filter(Boolean),
    showArchived,
  );
  const parents: (NodeId | null)[] = [];
  const stack: NodeSummary[] = [];
  for (const page of pages) {
    while (stack.length > page.pageLevel) stack.pop();
    parents.push(stack[stack.length - 1]?.id ?? null);
    stack.push(page);
  }
  const sizes = new Map<NodeId | null, number>();
  parents.forEach((parent) => sizes.set(parent, (sizes.get(parent) ?? 0) + 1));
  const seen = new Map<NodeId | null, number>();
  const rows: Row[] = [];
  let hiddenBelow = Infinity;
  pages.forEach((page, i) => {
    const position = (seen.get(parents[i]) ?? 0) + 1;
    seen.set(parents[i], position);
    if (page.pageLevel > hiddenBelow) return;
    hiddenBelow = Infinity;
    const next = pages[i + 1];
    const parent = next !== undefined && next.pageLevel > page.pageLevel;
    const open = parent && !state.folded[page.id];
    if (parent && !open) hiddenBelow = page.pageLevel;
    rows.push({
      id: page.id,
      node: page,
      level: page.pageLevel + 1,
      posinset: position,
      setsize: sizes.get(parents[i]) ?? 1,
      expanded: parent ? open : undefined,
      parentId: parents[i],
    });
  });
  return rows;
}

/** Memoizes a builder on the identity of its inputs. */
export function memoOn<A extends readonly unknown[], R>(build: (...args: A) => R): (...args: A) => R {
  let last: { args: A; value: R } | null = null;
  return (...args: A) => {
    if (last && last.args.length === args.length && last.args.every((arg, i) => Object.is(arg, args[i]))) {
      return last.value;
    }
    const value = build(...args);
    last = { args, value };
    return value;
  };
}
