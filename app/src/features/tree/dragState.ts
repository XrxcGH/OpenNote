// What the drag controller shares with the trees (ARCHITECTURE.md section 13.6): which row is being dragged, so
// windowing keeps it mounted, and where each tree is on screen, so a pointer over either tree finds its row by
// arithmetic. A page dragged from the pages tree can land on a section in the notebooks tree.

import type { NodeId, NotesService } from '../../services/notes';
import { createStore } from '../../state/store';
import type { MenuAnchor } from '../../ui';
import type { Geometry } from './drop';
import type { Row } from './rows';
import type { TreeId } from './store';

export const dragStore = createStore<{ readonly id: NodeId | null }>({ id: null }, 'tree drag');

export interface DragHost {
  readonly tree: TreeId;
  readonly notes: NotesService;
  /** The scrolling element with role="tree". */
  container(): HTMLElement | null;
  rows(): readonly Row[];
  openMenu(row: Row, anchor: MenuAnchor, returnFocus: HTMLElement): void;
}

const hosts = new Map<TreeId, DragHost>();

export function registerDragHost(host: DragHost): () => void {
  hosts.set(host.tree, host);
  return () => {
    if (hosts.get(host.tree) === host) hosts.delete(host.tree);
  };
}

/** The tree's latest registration. */
export function hostFor(tree: TreeId): DragHost | undefined {
  return hosts.get(tree);
}

/** The tree on screen at a point, if any. */
export function hostAt(x: number, y: number): DragHost | null {
  for (const host of hosts.values()) {
    const rect = host.container()?.getBoundingClientRect();
    if (rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return host;
  }
  return null;
}

/** The rows' place on screen, measured from the first row: rows have one height in a tree. */
export function geometryOf(host: DragHost): Geometry | null {
  const list = host.container()?.firstElementChild;
  const first = list?.querySelector('[role="treeitem"]');
  if (!list || !first) return null;
  return {
    top: list.getBoundingClientRect().top,
    rowHeight: first.getBoundingClientRect().height,
    count: host.rows().length,
  };
}

/** A row's element in a tree, if it is mounted. */
export function rowElementIn(tree: TreeId, id: NodeId): HTMLElement | null {
  const host = hosts.get(tree);
  return host?.container()?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`) ?? null;
}

/** A row's element in either tree. */
export function findRowElement(id: NodeId): HTMLElement | null {
  return [...hosts.keys()].map((tree) => rowElementIn(tree, id)).find(Boolean) ?? null;
}
