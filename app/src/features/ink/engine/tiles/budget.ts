// The tile memory budget (architecture 7.8). Phase 5 gets 40 MB of the app's memory. Visible tiles are always allowed,
// and each counts twice, because the compositor keeps a copy. The hidden cache gets whatever the split leaves after
// the fixed parts and the visible tiles, up to 6 MB, so a small window keeps more tiles and a 4K screen keeps none.
// The fixed part is provisional until week-one check I10 measures it on the reference laptop.

import { BYTES_PER_TILE } from './grid';
import type { TileBudget } from './planner';

const MIB = 1024 * 1024;

/** Phase 5's share of the app's memory. */
export const SPLIT_BYTES = 40 * MIB;
/** Encoded ink, the stroke table and index, the outline cache, the engine heap, the overview, sprites, and the live canvas. */
export const FIXED_BYTES = 19 * MIB;
/** The most the hidden tile cache may hold. */
export const MAX_HIDDEN_BYTES = 6 * MIB;
/** A tile costs its pixels twice: once in the engine and once in the compositor. */
export const BYTES_PER_TILE_COUNTED = BYTES_PER_TILE * 2;

export interface BudgetInput {
  /** Tiles the view needs. */
  readonly visibleTiles: number;
  /** Defaults to 40 MB. */
  readonly splitBytes?: number;
  /** Defaults to 19 MB. A page view in the background passes a quarter of its caches. */
  readonly fixedBytes?: number;
  /** Defaults to 6 MB. The highlighter mask takes this room while it exists. */
  readonly maxHiddenBytes?: number;
}

/** The bytes the hidden tile cache may hold. */
export function hiddenCacheBytes(input: BudgetInput): number {
  const { visibleTiles, splitBytes = SPLIT_BYTES, fixedBytes = FIXED_BYTES, maxHiddenBytes = MAX_HIDDEN_BYTES } = input;
  const left = splitBytes - fixedBytes - visibleTiles * BYTES_PER_TILE_COUNTED;
  return Math.min(maxHiddenBytes, Math.max(0, left));
}

/** The tile budget for the planner: the visible tiles plus as many hidden ones as the cache bytes hold. */
export function tileBudget(input: BudgetInput): TileBudget {
  return { maxTiles: input.visibleTiles + Math.floor(hiddenCacheBytes(input) / BYTES_PER_TILE_COUNTED) };
}

/** A page view in the background keeps only its visible tiles. */
export function backgroundBudget(visibleTiles: number): TileBudget {
  return { maxTiles: visibleTiles };
}
