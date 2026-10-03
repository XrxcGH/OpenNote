// Contract between the shell (Phase 2) and storage (Phase 3). Changes need approval from both phase owners.
//
// The reference model's state and shared rules. The model is a small, synchronous implementation of the
// semantics in ARCHITECTURE.md section 12.2. The property test compares a real service against it.

import { NotesError } from '../errors';
import type { InvalidNameReason, NotesErrorCode } from '../errors';
import { CHIP_COLORS, NOTES_LIMITS } from '../types';
import type { ChipColor, NodeId, NodeKind, NodeSummary, PageLevel } from '../types';

export interface Rec {
  readonly id: string;
  readonly kind: NodeKind;
  parentId: string | null;
  title: string;
  color: ChipColor | null;
  pageLevel: PageLevel;
  readonly created: string;
  modified: string;
  readonly readOnly: boolean;
}

/** One trashed root. A page takes its subpages with it; a container keeps its own child lists. */
export interface TrashEntry {
  readonly receiptId: string;
  readonly rootId: string;
  readonly parentId: string | null;
  /** The next sibling that stayed behind, so restore can put the root back before it. */
  readonly beforeId: string | null;
  readonly parentTitle: string;
  /** The notebook the root was in, where restore falls back to; null for a notebook. */
  readonly notebookId: string | null;
  readonly trashedAt: string;
  /** The root, then its subpages for a page. */
  readonly ids: readonly string[];
  readonly seq: number;
}

export interface ModelState {
  folder: string;
  readOnly: boolean;
  readonly nodes: Map<string, Rec>;
  /** Child ids in display order, keyed by parent id; ROOT holds the notebooks. */
  readonly lists: Map<string, string[]>;
  /** Every id inside a trashed subtree. */
  readonly trashed: Set<string>;
  trash: TrashEntry[];
  counter: number;
  readonly now: () => string;
}

export const ROOT = '';
export const MAX_TITLE = NOTES_LIMITS.titleLength;
export const DEFAULT_TITLES: Record<NodeKind, string> = {
  notebook: 'Untitled notebook',
  sectionGroup: 'Untitled section group',
  section: 'Untitled section',
  page: 'Untitled page',
};

const HOLDS: Record<NodeKind | 'root', readonly NodeKind[]> = {
  root: ['notebook'],
  notebook: ['sectionGroup', 'section'],
  sectionGroup: ['sectionGroup', 'section'],
  section: ['page'],
  page: [],
};

export function fail(code: NotesErrorCode, message: string, reason?: InvalidNameReason): never {
  throw new NotesError(code, message, reason);
}

export const keyOf = (parentId: string | null) => parentId ?? ROOT;

export function listOf(state: ModelState, parentId: string | null): string[] {
  const key = keyOf(parentId);
  let list = state.lists.get(key);
  if (!list) {
    list = [];
    state.lists.set(key, list);
  }
  return list;
}

export function isLive(state: ModelState, id: string | null): boolean {
  return id !== null && state.nodes.has(id) && !state.trashed.has(id);
}

export function live(state: ModelState, id: string): Rec {
  const rec = state.nodes.get(id);
  if (!rec || state.trashed.has(id)) fail('not-found', `No node ${id}`);
  return rec;
}

export function writable(state: ModelState, rec?: Rec): void {
  if (state.readOnly || rec?.readOnly) fail('read-only', `Read-only: ${rec?.id ?? 'library'}`);
}

export function canHold(parent: NodeKind | null, child: NodeKind): boolean {
  return HOLDS[parent ?? 'root'].includes(child);
}

export function validTitle(raw: string): string {
  const title = raw.trim();
  const length = [...title].length;
  if (length === 0) fail('invalid-name', 'Empty title', 'empty');
  if (length > MAX_TITLE) fail('invalid-name', 'Title too long', 'too-long');
  return title;
}

export function newId(state: ModelState, prefix: string): string {
  state.counter += 1;
  return `${prefix}${state.counter}`;
}

export function summary(state: ModelState, rec: Rec): NodeSummary {
  return {
    id: rec.id as NodeId,
    kind: rec.kind,
    parentId: rec.parentId as NodeId | null,
    title: rec.title,
    color: rec.kind === 'page' ? null : rec.color,
    pageLevel: rec.kind === 'page' ? rec.pageLevel : 0,
    childCount: rec.kind === 'page' ? 0 : (state.lists.get(rec.id)?.length ?? 0),
    created: rec.created,
    modified: rec.modified,
    readOnly: rec.readOnly,
  };
}

/** A pen name stays; anything else is stored as no color. */
export function penOrNull(color: ChipColor | null | undefined): ChipColor | null {
  return color && CHIP_COLORS.includes(color) ? color : null;
}

/** How many section groups hold `parentId`, counting itself: 0 for a notebook, 1 for a top-level group. */
export function groupDepth(state: ModelState, parentId: string | null): number {
  let depth = 0;
  for (let id = parentId; id !== null; id = state.nodes.get(id)?.parentId ?? null) {
    if (state.nodes.get(id)?.kind === 'sectionGroup') depth += 1;
  }
  return depth;
}

/** How many levels of section groups a node adds: 0 for anything but a group, 1 for a group of sections. */
export function groupHeight(state: ModelState, id: string): number {
  if (state.nodes.get(id)?.kind !== 'sectionGroup') return 0;
  return 1 + Math.max(0, ...(state.lists.get(id) ?? []).map((child) => groupHeight(state, child)));
}

/** True when a node of this height fits under the parent without nesting groups too deep. */
export function fitsDepth(state: ModelState, parentId: string | null, height: number): boolean {
  return groupDepth(state, parentId) + height <= NOTES_LIMITS.groupDepth;
}

/** The notebook that holds a node, or null for a notebook. */
export function notebookOf(state: ModelState, id: string): string | null {
  let parent = state.nodes.get(id)?.parentId ?? null;
  while (parent !== null && state.nodes.get(parent)?.parentId != null)
    parent = state.nodes.get(parent)?.parentId ?? null;
  return parent;
}

/** True when an ancestor of `id` (following parent ids) is in `ids`. */
export function hasAncestorIn(state: ModelState, id: string, ids: ReadonlySet<string>): boolean {
  let parent = state.nodes.get(id)?.parentId ?? null;
  while (parent !== null) {
    if (ids.has(parent)) return true;
    parent = state.nodes.get(parent)?.parentId ?? null;
  }
  return false;
}

/** Every id in a container's subtree, including itself. */
export function subtree(state: ModelState, id: string): string[] {
  return [id, ...(state.lists.get(id) ?? []).flatMap((child) => subtree(state, child))];
}

/** Position of each live node in a depth-first walk, for sorting ids into display order. */
export function displayOrder(state: ModelState): Map<string, number> {
  const order = new Map<string, number>();
  const walk = (parent: string) =>
    (state.lists.get(parent) ?? []).forEach((id) => {
      order.set(id, order.size);
      walk(id);
    });
  walk(ROOT);
  return order;
}

/** A clock that moves one second per call, so dates are distinct and deterministic. */
export function steppingClock(start = Date.parse('2026-09-30T09:00:00.000Z')): () => string {
  let now = start;
  return () => {
    now += 1000;
    return new Date(now).toISOString();
  };
}
