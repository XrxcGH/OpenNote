// Contract between the shell (Phase 2) and storage (Phase 3). Changes need approval from both phase owners.
//
// Moves and page levels in the reference model. The rules come from ARCHITECTURE.md section 12.2.
//
// - In a section, the first page has level 0, and each page is at most one level deeper than the page before.
//
// - A page's subpages are the pages right after it with a higher level. They move and go to Trash with it.
//
// - A moved page block keeps its shape. Its first page rises to fit after the page before it, never deeper.
//
// - A move that would leave the next page too deep rejects with invalid-move.

import type { Placement, PageLevel } from '../types';
import { canHold, fail, hasAncestorIn, keyOf, listOf, live, writable } from './model-state';
import type { ModelState, Rec } from './model-state';

/** The page at `index` and the pages after it with a higher level. */
export function blockAt(list: readonly string[], index: number, level: (id: string) => number): string[] {
  const root = level(list[index]);
  let end = index + 1;
  while (end < list.length && level(list[end]) > root) end += 1;
  return list.slice(index, end);
}

export function levelsValid(levels: readonly number[]): boolean {
  return levels.every((level, i) => level >= 0 && level <= 2 && level <= (i === 0 ? 0 : levels[i - 1] + 1));
}

const pageLevel = (state: ModelState) => (id: string) => state.nodes.get(id)?.pageLevel ?? 0;

/**
 * Fits page blocks inserted at `index` of `reduced`, the section without them. Each block's first page rises to at
 * most one level below the page before it, and the rest of the block shifts with it.
 * Returns null when the page after the inserted blocks would be too deep.
 */
export function fitBlocks(
  state: ModelState,
  reduced: readonly string[],
  index: number,
  blocks: readonly (readonly string[])[],
): Map<string, PageLevel> | null {
  const level = pageLevel(state);
  const levels = new Map<string, PageLevel>();
  let previous = index > 0 ? level(reduced[index - 1]) : -1;
  for (const block of blocks) {
    const delta = Math.min(level(block[0]), previous + 1) - level(block[0]);
    block.forEach((id) => levels.set(id, (level(id) + delta) as PageLevel));
    previous = levels.get(block[block.length - 1]) ?? previous;
  }
  const next = reduced[index];
  return next !== undefined && level(next) > previous + 1 ? null : levels;
}

/** The moved roots: ids that aren't inside another moved container or another moved page's block. */
export function movedBlocksOf(state: ModelState, recs: readonly Rec[]): string[][] {
  const ids = new Set(recs.map((rec) => rec.id));
  const level = pageLevel(state);
  const blocks = recs
    .filter((rec) => !hasAncestorIn(state, rec.id, ids))
    .map((rec) => {
      if (rec.kind !== 'page') return [rec.id];
      const list = listOf(state, rec.parentId);
      return blockAt(list, list.indexOf(rec.id), level);
    });
  return blocks.filter((block) => !blocks.some((other) => other !== block && other.slice(1).includes(block[0])));
}

function checkTarget(state: ModelState, recs: readonly Rec[], placement: Placement): Rec | null {
  const parent = placement.parentId === null ? null : live(state, placement.parentId);
  writable(state, parent ?? undefined);
  for (const rec of recs) {
    if (!canHold(parent?.kind ?? null, rec.kind)) fail('invalid-move', `${rec.kind} can't go there`);
    if (parent && (parent.id === rec.id || hasAncestorIn(state, parent.id, new Set([rec.id])))) {
      fail('invalid-move', 'A node cannot move into itself');
    }
  }
  if (placement.beforeId !== null) {
    live(state, placement.beforeId);
    if (!listOf(state, placement.parentId).includes(placement.beforeId)) fail('invalid-move', 'Not a sibling');
  }
  return parent;
}

function insertionIndex(
  target: readonly string[],
  reduced: readonly string[],
  beforeId: string | null,
  moved: Set<string>,
) {
  if (beforeId === null) return reduced.length;
  if (!moved.has(beforeId)) return reduced.indexOf(beforeId);
  const after = target.slice(target.indexOf(beforeId) + 1).find((id) => !moved.has(id));
  return after === undefined ? reduced.length : reduced.indexOf(after);
}

export function move(state: ModelState, ids: readonly string[], placement: Placement): void {
  const recs = [...new Set(ids)].map((id) => live(state, id));
  recs.forEach((rec) => writable(state, rec));
  const parent = checkTarget(state, recs, placement);
  const blocks = movedBlocksOf(state, recs);
  const moved = new Set(blocks.flat());
  const target = listOf(state, placement.parentId);
  const reduced = target.filter((id) => !moved.has(id));
  const index = insertionIndex(target, reduced, placement.beforeId, moved);
  const levels = parent?.kind === 'section' ? fitBlocks(state, reduced, index, blocks) : new Map<string, PageLevel>();
  if (!levels) fail('invalid-move', 'The next page would be too deep');
  const next = [...reduced.slice(0, index), ...blocks.flat(), ...reduced.slice(index)];
  for (const id of moved) {
    const rec = live(state, id);
    if (rec.parentId !== placement.parentId) {
      const source = listOf(state, rec.parentId);
      source.splice(source.indexOf(id), 1);
      rec.parentId = placement.parentId;
    }
  }
  state.lists.set(keyOf(placement.parentId), next);
  levels.forEach((level, id) => (live(state, id).pageLevel = level));
}

/** Sets each page's level and shifts its subpages by the same amount. Nothing changes on a rejection. */
export function setPageLevel(state: ModelState, ids: readonly string[], level: PageLevel): void {
  if (![0, 1, 2].includes(level)) fail('invalid-move', `Level ${String(level)}`);
  const recs = [...new Set(ids)].map((id) => live(state, id));
  recs.forEach((rec) => {
    writable(state, rec);
    if (rec.kind !== 'page') fail('invalid-move', 'Only pages have levels');
  });
  const changes = new Map<string, PageLevel>();
  for (const sectionId of new Set(recs.map((rec) => rec.parentId))) {
    const list = listOf(state, sectionId);
    const levels = list.map((id) => live(state, id).pageLevel as number);
    const targets = recs.filter((rec) => rec.parentId === sectionId).map((rec) => list.indexOf(rec.id));
    for (const index of targets.sort((a, b) => a - b)) {
      const block = blockAt(list, index, (id) => levels[list.indexOf(id)]);
      const delta = level - levels[index];
      block.forEach((id) => (levels[list.indexOf(id)] += delta));
    }
    if (!levelsValid(levels)) fail('invalid-move', 'Page levels would break the rules');
    list.forEach((id, i) => changes.set(id, levels[i] as PageLevel));
  }
  changes.forEach((value, id) => (live(state, id).pageLevel = value));
}

/** Clamps each page to at most one level below the page before it, after a restore. */
export function normalizeLevels(state: ModelState, sectionId: string): void {
  let previous = -1;
  for (const id of listOf(state, sectionId)) {
    const rec = live(state, id);
    rec.pageLevel = Math.min(rec.pageLevel, previous + 1) as PageLevel;
    previous = rec.pageLevel;
  }
}
