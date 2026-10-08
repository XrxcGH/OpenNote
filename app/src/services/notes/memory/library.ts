// The in-memory library behind the Phase 2 notes service (ARCHITECTURE.md section 12.3): nodes by id, each
// parent's children in display order, and the Trash records. Every rule lives in writes.ts and trash.ts; this
// module holds the state and the questions they ask of it.

import { NotesError } from '../errors';
import type { InvalidNameReason, NotesErrorCode } from '../errors';
import type { FixtureData, FixtureNode } from '../fixtures';
import { CHIP_COLORS, NOTES_LIMITS } from '../types';
import type { ChipColor, NodeId, NodeKind, NodeSummary, PageLevel } from '../types';

export interface MemNode {
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

/** One trashed root: a container with its subtree, or a page with its subpages. */
export interface TrashRecord {
  readonly receiptId: string;
  /** The root, then its subpages for a page. */
  readonly ids: readonly string[];
  readonly parentId: string | null;
  /** The sibling that followed the root and stayed, so restore can put it back before it. */
  readonly beforeId: string | null;
  readonly parentTitle: string;
  /** The notebook whose Trash holds it; null for a notebook. */
  readonly notebookId: string | null;
  readonly trashedAt: string;
}

const ROOT = '';
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

export function penOrNull(color: ChipColor | null | undefined): ChipColor | null {
  return color && CHIP_COLORS.includes(color) ? color : null;
}

export function canHold(parent: NodeKind | null, child: NodeKind): boolean {
  return HOLDS[parent ?? 'root'].includes(child);
}

export function checkedTitle(raw: string): string {
  const title = raw.trim();
  const length = [...title].length;
  if (length === 0) fail('invalid-name', 'The title is empty.', 'empty');
  if (length > NOTES_LIMITS.titleLength) fail('invalid-name', 'The title is too long.', 'too-long');
  return title;
}

export class Library {
  readonly nodes = new Map<string, MemNode>();
  /** Children in display order by parent id; '' holds the notebooks. */
  readonly kids = new Map<string, string[]>([[ROOT, []]]);
  /** Every id inside a trashed subtree. */
  readonly trashed = new Set<string>();
  /** Oldest first. */
  records: TrashRecord[] = [];
  readonly folder: string;
  readonly readOnly: boolean;

  constructor(data: FixtureData) {
    this.folder = data.folder;
    this.readOnly = data.readOnly ?? false;
    this.seed(data.notebooks, null);
  }

  /** Adds fixture nodes, and their subtrees, at the end of a parent's children. */
  seed(nodes: readonly FixtureNode[], parentId: string | null, into: string[] = this.kidsOf(parentId)): void {
    for (const node of nodes) {
      const created = node.created ?? '2026-09-01T09:00:00.000Z';
      this.nodes.set(node.id, {
        id: node.id,
        kind: node.kind,
        parentId,
        title: node.title,
        color: penOrNull(node.color),
        pageLevel: node.kind === 'page' ? (node.pageLevel ?? 0) : 0,
        created,
        modified: node.modified ?? created,
        readOnly: node.readOnly ?? false,
      });
      into.push(node.id);
      if (node.kind !== 'page') this.seed(node.children ?? [], node.id);
    }
  }

  kidsOf(parentId: string | null): string[] {
    const key = parentId ?? ROOT;
    let list = this.kids.get(key);
    if (!list) {
      list = [];
      this.kids.set(key, list);
    }
    return list;
  }

  setKids(parentId: string | null, ids: string[]): void {
    this.kids.set(parentId ?? ROOT, ids);
  }

  isLive(id: string | null): id is string {
    return id !== null && this.nodes.has(id) && !this.trashed.has(id);
  }

  /** A node that isn't in Trash, or not-found. */
  live(id: string): MemNode {
    const node = this.nodes.get(id);
    if (!node || this.trashed.has(id)) fail('not-found', `No node ${id}`);
    return node;
  }

  /** Any node, including one in Trash. */
  any(id: string): MemNode {
    return this.nodes.get(id) ?? fail('io', `Lost the node ${id}`);
  }

  writable(node?: MemNode): void {
    if (this.readOnly || node?.readOnly) fail('read-only', `Read-only: ${node?.id ?? 'the library'}`);
  }

  summary(node: MemNode): NodeSummary {
    const page = node.kind === 'page';
    return {
      id: node.id as NodeId,
      kind: node.kind,
      parentId: node.parentId as NodeId | null,
      title: node.title,
      color: node.color,
      pageLevel: page ? node.pageLevel : 0,
      childCount: page ? 0 : (this.kids.get(node.id)?.length ?? 0),
      created: node.created,
      modified: node.modified,
      readOnly: node.readOnly,
    };
  }

  summaries(ids: readonly string[]): NodeSummary[] {
    return ids.map((id) => this.summary(this.any(id)));
  }

  /** True when some ancestor of `id` is in `ids`. */
  insideAny(id: string, ids: ReadonlySet<string>): boolean {
    for (let at = this.nodes.get(id)?.parentId ?? null; at !== null; at = this.nodes.get(at)?.parentId ?? null) {
      if (ids.has(at)) return true;
    }
    return false;
  }

  /** Section groups at and above `parentId`: 0 for a notebook, 1 for a top-level group. */
  groupDepth(parentId: string | null): number {
    let depth = 0;
    for (let at = parentId; at !== null; at = this.nodes.get(at)?.parentId ?? null) {
      if (this.nodes.get(at)?.kind === 'sectionGroup') depth += 1;
    }
    return depth;
  }

  /** Levels of section groups a node brings with it: 0 unless it is a group. */
  groupHeight(id: string): number {
    if (this.nodes.get(id)?.kind !== 'sectionGroup') return 0;
    const inner = (this.kids.get(id) ?? []).map((child) => this.groupHeight(child));
    return 1 + Math.max(0, ...inner);
  }

  fitsDepth(parentId: string | null, id: string): boolean {
    return this.groupDepth(parentId) + this.groupHeight(id) <= NOTES_LIMITS.groupDepth;
  }

  notebookOf(id: string): string | null {
    let at = this.nodes.get(id)?.parentId ?? null;
    while (at !== null) {
      const parent = this.nodes.get(at)?.parentId ?? null;
      if (parent === null) return at;
      at = parent;
    }
    return null;
  }

  /** A container and everything under it, or a page alone. */
  subtree(id: string): string[] {
    return [id, ...(this.kids.get(id) ?? []).flatMap((child) => this.subtree(child))];
  }

  /** Each live node's place in a depth-first walk. */
  displayOrder(): Map<string, number> {
    const order = new Map<string, number>();
    const walk = (parent: string) => {
      for (const id of this.kids.get(parent) ?? []) {
        order.set(id, order.size);
        walk(id);
      }
    };
    walk(ROOT);
    return order;
  }

  /** A fixture node with its subtree, for the snapshot. */
  toFixture(id: string): FixtureNode {
    const node = this.any(id);
    const base = {
      id: node.id,
      kind: node.kind,
      title: node.title,
      created: node.created,
      modified: node.modified,
      ...(node.readOnly && { readOnly: true }),
    };
    if (node.kind === 'page') return { ...base, pageLevel: node.pageLevel };
    return { ...base, color: node.color, children: (this.kids.get(id) ?? []).map((child) => this.toFixture(child)) };
  }
}
