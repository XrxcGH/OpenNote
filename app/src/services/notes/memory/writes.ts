// Changes to the in-memory library: create, rename, color, move, and page levels, following ARCHITECTURE.md
// section 12.2 and ADR 0014. Each function checks everything before it changes anything, so a rejection leaves
// the library as it was.

import type { CreateInput, NodeKind, PageLevel, Placement } from '../types';
import { NOTES_LIMITS } from '../types';
import type { Library, MemNode } from './library';
import { canHold, checkedTitle, fail, penOrNull } from './library';
import { blockEnd, fitBlocks, levelsValid } from './pages';

export const DEFAULT_TITLES: Record<NodeKind, string> = {
  notebook: 'Untitled notebook',
  sectionGroup: 'Untitled section group',
  section: 'Untitled section',
  page: 'Untitled page',
};

const levelsOf = (lib: Library, ids: readonly string[]) => ids.map((id) => lib.any(id).pageLevel as number);

/** Where a new or moved node goes: the parent, checked, and the index `beforeId` names in `list`. */
function checkBefore(lib: Library, list: readonly string[], beforeId: string | null): void {
  if (beforeId !== null && !list.includes(lib.live(beforeId).id)) fail('invalid-move', 'Not a child of the parent');
}

function parentOf(lib: Library, parentId: string | null): MemNode | null {
  const parent = parentId === null ? null : lib.live(parentId);
  lib.writable(parent ?? undefined);
  return parent;
}

export function create(lib: Library, input: CreateInput, id: string, now: string): MemNode {
  const title = checkedTitle(input.title ?? DEFAULT_TITLES[input.kind]);
  const { parentId, beforeId } = input.placement;
  const parent = parentOf(lib, parentId);
  if (!canHold(parent?.kind ?? null, input.kind)) fail('invalid-move', `A ${input.kind} can't go there`);
  if (input.kind === 'sectionGroup' && lib.groupDepth(parentId) >= NOTES_LIMITS.groupDepth) {
    fail('invalid-move', 'Section groups would nest too deep');
  }
  const list = lib.kidsOf(parentId);
  checkBefore(lib, list, beforeId);
  const index = beforeId === null ? list.length : list.indexOf(beforeId);
  const page = input.kind === 'page';
  const pageLevel = page ? (input.pageLevel ?? 0) : 0;
  if (page) checkNewPage(lib, list, index, pageLevel);
  const node: MemNode = {
    id,
    kind: input.kind,
    parentId,
    title,
    color: page ? null : penOrNull(input.color),
    pageLevel,
    created: now,
    modified: now,
    readOnly: false,
  };
  lib.nodes.set(id, node);
  list.splice(index, 0, id);
  return node;
}

/** A new page must fit where it goes without changing any level, and leave the next page valid. */
function checkNewPage(lib: Library, list: readonly string[], index: number, level: number): void {
  const levels = levelsOf(lib, list);
  const fitted = fitBlocks(index > 0 ? levels[index - 1] : -1, [[level]], levels[index]);
  if (level > NOTES_LIMITS.pageLevel || !fitted || fitted[0][0] !== level) {
    fail('invalid-move', 'The page level breaks the rules');
  }
}

export function rename(lib: Library, id: string, title: string, now: string): MemNode {
  const node = lib.live(id);
  lib.writable(node);
  node.title = checkedTitle(title);
  node.modified = now;
  return node;
}

export function setColor(lib: Library, id: string, color: MemNode['color'], now: string): MemNode {
  const node = lib.live(id);
  lib.writable(node);
  node.color = penOrNull(color);
  node.modified = now;
  return node;
}

/** The moved roots as blocks: nodes inside another moved container go with it, and a page takes its subpages. */
export function movedBlocks(lib: Library, nodes: readonly MemNode[]): string[][] {
  const ids = new Set(nodes.map((node) => node.id));
  const blocks = nodes
    .filter((node) => !lib.insideAny(node.id, ids))
    .map((node) => {
      if (node.kind !== 'page') return [node.id];
      const list = lib.kidsOf(node.parentId);
      const start = list.indexOf(node.id);
      return list.slice(start, blockEnd(levelsOf(lib, list), start));
    });
  const tails = new Set(blocks.flatMap((block) => block.slice(1)));
  return blocks.filter((block) => !tails.has(block[0]));
}

function checkTarget(lib: Library, nodes: readonly MemNode[], placement: Placement): MemNode | null {
  const parent = parentOf(lib, placement.parentId);
  for (const node of nodes) {
    if (!canHold(parent?.kind ?? null, node.kind)) fail('invalid-move', `A ${node.kind} can't go there`);
    if (parent && (parent.id === node.id || lib.insideAny(parent.id, new Set([node.id])))) {
      fail('invalid-move', 'A node cannot move into itself');
    }
    if (!lib.fitsDepth(placement.parentId, node.id)) fail('invalid-move', 'Section groups would nest too deep');
  }
  checkBefore(lib, lib.kidsOf(placement.parentId), placement.beforeId);
  return parent;
}

/** Where the moved blocks go in the target's children once they are taken out. */
function insertAt(target: readonly string[], rest: readonly string[], beforeId: string | null, moved: Set<string>) {
  if (beforeId === null) return rest.length;
  const anchor = moved.has(beforeId)
    ? target.slice(target.indexOf(beforeId) + 1).find((id) => !moved.has(id))
    : beforeId;
  return anchor === undefined ? rest.length : rest.indexOf(anchor);
}

export function move(lib: Library, ids: readonly string[], placement: Placement): void {
  const nodes = [...new Set(ids)].map((id) => lib.live(id));
  nodes.forEach((node) => lib.writable(node));
  const parent = checkTarget(lib, nodes, placement);
  const blocks = movedBlocks(lib, nodes);
  const moved = new Set(blocks.flat());
  const target = lib.kidsOf(placement.parentId);
  const rest = target.filter((id) => !moved.has(id));
  const at = insertAt(target, rest, placement.beforeId, moved);
  let levels: number[][] | null = blocks.map((block) => levelsOf(lib, block));
  if (parent?.kind === 'section') {
    const restLevels = levelsOf(lib, rest);
    levels = fitBlocks(at > 0 ? restLevels[at - 1] : -1, levels, restLevels[at]);
    if (!levels) fail('invalid-move', 'The next page would be too deep');
  }
  for (const id of moved) {
    const node = lib.any(id);
    if (node.parentId === placement.parentId) continue;
    const source = lib.kidsOf(node.parentId);
    source.splice(source.indexOf(id), 1);
    node.parentId = placement.parentId;
  }
  lib.setKids(placement.parentId, [...rest.slice(0, at), ...blocks.flat(), ...rest.slice(at)]);
  const fitted = levels;
  blocks.forEach((block, b) => block.forEach((id, i) => (lib.any(id).pageLevel = fitted[b][i] as PageLevel)));
}

/** Sets each page's level and shifts its subpages with it. Nothing changes on a rejection. */
export function setPageLevel(lib: Library, ids: readonly string[], level: PageLevel): void {
  if (!Number.isInteger(level) || level < 0 || level > NOTES_LIMITS.pageLevel) fail('invalid-move', 'No such level');
  const nodes = [...new Set(ids)].map((id) => lib.live(id));
  for (const node of nodes) {
    lib.writable(node);
    if (node.kind !== 'page') fail('invalid-move', 'Only pages have levels');
  }
  const changes: [string, number][] = [];
  for (const sectionId of new Set(nodes.map((node) => node.parentId))) {
    const list = lib.kidsOf(sectionId);
    const levels = levelsOf(lib, list);
    const starts = nodes.filter((node) => node.parentId === sectionId).map((node) => list.indexOf(node.id));
    for (const start of starts.sort((a, b) => a - b)) {
      const shift = level - levels[start];
      const end = blockEnd(levels, start);
      for (let i = start; i < end; i += 1) levels[i] += shift;
    }
    if (!levelsValid(levels)) fail('invalid-move', 'The page levels would break the rules');
    list.forEach((id, i) => changes.push([id, levels[i]]));
  }
  for (const [id, value] of changes) lib.any(id).pageLevel = value as PageLevel;
}
