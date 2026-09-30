// The places Move to offers (ARCHITECTURE.md section 13.6): sections for a page; notebooks and section groups for
// a section; and notebooks and section groups for a group, except itself, what is inside it, and places that
// would nest groups too deep. Notebooks can't move. The list is in tree order, each with its path.

import type { NodeId, NodeKind, NodeSummary } from '../../services/notes';
import { NOTES_LIMITS } from '../../services/notes';
import { titleOf } from './actions';
import { foldText } from './fold';
import { ensureChildren } from './load';
import { ancestors, keyOf, treeStore } from './store';
import type { TreeState } from './store';

export interface Destination {
  readonly id: NodeId;
  readonly kind: NodeKind;
  readonly title: string;
  /** "Biology 101 / Labs". */
  readonly path: string;
  /** 0 for a notebook. */
  readonly depth: number;
}

/** Every notebook, section group, and section, in tree order. Loads what isn't loaded yet. */
export async function loadDestinations(): Promise<Destination[]> {
  const out: Destination[] = [];
  const walk = async (parent: NodeId | null, path: readonly string[], depth: number) => {
    if (parent) await ensureChildren(parent);
    const state = treeStore.get();
    for (const id of state.children[keyOf(parent)] ?? []) {
      const child = state.nodes[id];
      if (!child || child.kind === 'page') continue;
      const here = [...path, titleOf(child)];
      out.push({ id, kind: child.kind, title: titleOf(child), path: here.join(' / '), depth });
      if (child.kind !== 'section') await walk(id, here, depth + 1);
    }
  };
  await walk(null, [], 0);
  return out;
}

/** Section groups between a node and its notebook, counting itself when it is one. */
function groupDepth(state: TreeState, id: NodeId): number {
  const node = state.nodes[id];
  const above = ancestors(state, id).filter((other) => other.kind === 'sectionGroup').length;
  return above + (node?.kind === 'sectionGroup' ? 1 : 0);
}

/** How many levels of section groups a group holds, counting itself. */
function groupHeight(state: TreeState, id: NodeId): number {
  const inner = (state.children[id] ?? []).filter((child) => state.nodes[child]?.kind === 'sectionGroup');
  return 1 + Math.max(0, ...inner.map((child) => groupHeight(state, child)));
}

function accepts(state: TreeState, node: NodeSummary, place: Destination): boolean {
  if (place.id === node.parentId || place.id === node.id) return false;
  if (node.kind === 'page') return place.kind === 'section';
  if (place.kind === 'section') return false;
  if (node.kind === 'notebook') return false;
  if (node.kind === 'sectionGroup') {
    if (ancestors(state, place.id).some((above) => above.id === node.id)) return false;
    const deepest = groupDepth(state, place.id) + groupHeight(state, node.id);
    return deepest <= NOTES_LIMITS.groupDepth;
  }
  return true;
}

/** The places a node can move to, from every place in the library. */
export function destinationsFor(state: TreeState, node: NodeSummary, all: readonly Destination[]): Destination[] {
  return all.filter((place) => accepts(state, node, place));
}

/** The places that match a filter, ignoring case, and accents. */
export function matchDestinations(places: readonly Destination[], filter: string): Destination[] {
  const words = foldText(filter).split(/\s+/).filter(Boolean);
  return places.filter((place) => words.every((word) => foldText(place.path).includes(word)));
}
