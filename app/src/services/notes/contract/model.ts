// Contract between the shell (Phase 2) and storage (Phase 3). Changes need approval from both phase owners.
//
// The reference model: a small, synchronous implementation of the notes contract. The property test runs the
// same random operations against a service and this model and requires identical trees. It also backs
// createModelService, which proves the contract suite itself.

import { resolveFixture } from '../fixtures';
import type { FixtureNode, NotesFixture } from '../fixtures';
import type {
  ChipColor,
  CreateInput,
  InitialTree,
  NodeId,
  NodeSummary,
  PageLevel,
  Placement,
  TrashedItem,
  TrashReceipt,
} from '../types';
import { fitBlocks, move, setPageLevel } from './model-moves';
import {
  canHold,
  DEFAULT_TITLES,
  fail,
  fitsDepth,
  isLive,
  listOf,
  live,
  newId,
  penOrNull,
  ROOT,
  steppingClock,
  summary,
  validTitle,
  writable,
} from './model-state';
import type { ModelState } from './model-state';
import { listTrash, restore, restoreFromTrash, trash } from './model-trash';

export interface ModelOptions {
  seed?: NotesFixture;
  now?: () => string;
}

function seedNodes(state: ModelState, nodes: readonly FixtureNode[], parentId: string | null): void {
  for (const node of nodes) {
    const created = node.created ?? state.now();
    state.nodes.set(node.id, {
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
    listOf(state, parentId).push(node.id);
    seedNodes(state, node.children ?? [], node.id);
  }
}

export class NotesModel {
  readonly state: ModelState;

  constructor(options: ModelOptions = {}) {
    const seed = resolveFixture(options.seed ?? 'empty');
    this.state = {
      folder: seed.folder,
      readOnly: seed.readOnly ?? false,
      nodes: new Map(),
      lists: new Map([[ROOT, []]]),
      trashed: new Set(),
      trash: [],
      counter: 0,
      now: options.now ?? steppingClock(),
    };
    seedNodes(this.state, seed.notebooks, null);
  }

  private summaries(ids: readonly string[]): NodeSummary[] {
    return ids.map((id) => summary(this.state, live(this.state, id)));
  }

  listNotebooks(): NodeSummary[] {
    return this.summaries(listOf(this.state, null));
  }

  listChildren(parentId: string): NodeSummary[] {
    const parent = live(this.state, parentId);
    return parent.kind === 'page' ? [] : this.summaries(listOf(this.state, parentId));
  }

  get(id: string): NodeSummary | null {
    return isLive(this.state, id) ? summary(this.state, live(this.state, id)) : null;
  }

  loadInitial(path: readonly string[]): InitialTree {
    const resolved: string[] = [];
    for (const id of path) {
      const parent = resolved.length ? resolved[resolved.length - 1] : null;
      if (!isLive(this.state, id) || live(this.state, id).parentId !== parent) break;
      resolved.push(id);
    }
    const containers = resolved.filter((id) => live(this.state, id).kind !== 'page');
    const last = resolved.length ? live(this.state, resolved[resolved.length - 1]) : null;
    return {
      library: { folder: this.state.folder, readOnly: this.state.readOnly },
      notebooks: this.listNotebooks(),
      children: Object.fromEntries(containers.map((id) => [id, this.listChildren(id)])),
      resolvedPath: resolved as NodeId[],
      page: last?.kind === 'page' ? summary(this.state, last) : null,
    };
  }

  create(input: CreateInput): NodeSummary {
    const state = this.state;
    const title = validTitle(input.title ?? DEFAULT_TITLES[input.kind]);
    const { parentId, beforeId } = input.placement;
    const parent = parentId === null ? null : live(state, parentId);
    writable(state, parent ?? undefined);
    if (!canHold(parent?.kind ?? null, input.kind)) fail('invalid-move', `${input.kind} can't go there`);
    if (input.kind === 'sectionGroup' && !fitsDepth(state, parentId, 1)) fail('invalid-move', 'Groups nest too deep');
    const list = listOf(state, parentId);
    if (beforeId !== null && !list.includes(live(state, beforeId).id)) fail('invalid-move', 'Not a sibling');
    const index = beforeId === null ? list.length : list.indexOf(beforeId);
    const pageLevel: PageLevel = input.kind === 'page' ? (input.pageLevel ?? 0) : 0;
    const id = newId(state, 'm');
    const now = state.now();
    const color = input.kind === 'page' ? null : penOrNull(input.color);
    const rec = {
      id,
      kind: input.kind,
      parentId,
      title,
      color,
      pageLevel,
      created: now,
      modified: now,
      readOnly: false,
    };
    state.nodes.set(id, rec);
    if (input.kind === 'page' && !fitsExactly(state, list, index, id)) {
      state.nodes.delete(id);
      fail('invalid-move', 'The page level breaks the rules');
    }
    list.splice(index, 0, id);
    return summary(state, rec);
  }

  rename(id: string, title: string): NodeSummary {
    const rec = live(this.state, id);
    writable(this.state, rec);
    rec.title = validTitle(title);
    rec.modified = this.state.now();
    return summary(this.state, rec);
  }

  setColor(id: string, color: ChipColor | null): NodeSummary {
    const rec = live(this.state, id);
    writable(this.state, rec);
    rec.color = penOrNull(color);
    rec.modified = this.state.now();
    return summary(this.state, rec);
  }

  move(ids: readonly string[], placement: Placement): void {
    move(this.state, ids, placement);
  }

  setPageLevel(ids: readonly string[], level: PageLevel): void {
    setPageLevel(this.state, ids, level);
  }

  trash(ids: readonly string[]): TrashReceipt {
    return trash(this.state, ids);
  }

  restore(receiptId: string): NodeSummary[] {
    return restore(this.state, receiptId);
  }

  restoreFromTrash(ids: readonly string[]): NodeSummary[] {
    return restoreFromTrash(this.state, ids);
  }

  listTrash(): TrashedItem[] {
    return listTrash(this.state);
  }
}

/** A new page must fit where it is created without changing any level. */
function fitsExactly(state: ModelState, list: readonly string[], index: number, id: string): boolean {
  const levels = fitBlocks(state, list, index, [[id]]);
  return levels !== null && levels.get(id) === live(state, id).pageLevel;
}
