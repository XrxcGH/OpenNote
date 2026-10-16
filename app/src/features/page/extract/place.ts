// Where a new page goes when Extract, Merge, or Split make one: just after the page it came from.
import type { NodeId, NodeSummary, NotesService, PageLevel } from '../../../services/notes/types';
import { shownMounted } from '../pagesApi';

export interface Place {
  parentId: NodeId | null;
  beforeId: NodeId | null;
  level: PageLevel;
}

/** Just after a page and its subpages, one level deeper (subpages go no deeper than two levels). */
export async function placeAfter(notes: NotesService, page: NodeSummary, deeper: boolean): Promise<Place> {
  const list = page.parentId ? await notes.listChildren(page.parentId) : [];
  let at = list.findIndex((node) => node.id === page.id) + 1;
  while (at > 0 && at < list.length && list[at].pageLevel > page.pageLevel) at += 1;
  const level = Math.min(2, page.pageLevel + (deeper ? 1 : 0)) as PageLevel;
  return { parentId: page.parentId, beforeId: list[at]?.id ?? null, level };
}

export const createPage = (notes: NotesService, place: Place, title: string) =>
  notes.create({
    kind: 'page',
    placement: { parentId: place.parentId, beforeId: place.beforeId },
    title,
    pageLevel: place.level,
  });

export async function shownPageNode(notes: NotesService): Promise<NodeSummary | null> {
  const mounted = shownMounted.get();
  return mounted ? notes.get(mounted.page.id as NodeId) : null;
}
