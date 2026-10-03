// Page levels (ARCHITECTURE.md section 12.2), on plain arrays of levels so the rules are easy to test:
//
// - In a section, the first page has level 0, and each page is at most one level deeper than the one before.
//
// - A page's block is the page and the pages right after it with a higher level: its subpages.
//
// - An inserted block keeps its shape, and its first page rises until it fits after the page before it.

import { NOTES_LIMITS } from '../types';
import type { PageLevel } from '../types';

/** The index just past the block that starts at `index`. */
export function blockEnd(levels: readonly number[], index: number): number {
  let end = index + 1;
  while (end < levels.length && levels[end] > levels[index]) end += 1;
  return end;
}

export function levelsValid(levels: readonly number[]): boolean {
  return levels.every(
    (level, i) => level >= 0 && level <= NOTES_LIMITS.pageLevel && level <= (i === 0 ? 0 : levels[i - 1] + 1),
  );
}

/**
 * The new levels of blocks inserted between a page at level `before` (-1 when they go first) and a page at
 * level `after` (undefined when they go last). Returns null when the page after them would be too deep.
 */
export function fitBlocks(
  before: number,
  blocks: readonly (readonly number[])[],
  after: number | undefined,
): number[][] | null {
  let previous = before;
  const fitted = blocks.map((block) => {
    const shift = Math.min(block[0], previous + 1) - block[0];
    const levels = block.map((level) => level + shift);
    previous = levels[levels.length - 1];
    return levels;
  });
  return after !== undefined && after > previous + 1 ? null : fitted;
}

/** Clamps each page to at most one level below the page before it. */
export function normalized(levels: readonly number[]): PageLevel[] {
  let previous = -1;
  return levels.map((level) => {
    previous = Math.min(level, previous + 1);
    return previous as PageLevel;
  });
}
