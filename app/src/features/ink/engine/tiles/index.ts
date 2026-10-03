// The tile cache planner: grid math, which tiles to draw, which to give back, and which to redraw after a change.

export { backgroundBudget, hiddenCacheBytes, tileBudget } from './budget';
export type { BudgetInput } from './budget';
export {
  BYTES_PER_TILE,
  eachTile,
  growRange,
  inRange,
  MAX_SCALE,
  MIN_SCALE,
  rangeCount,
  scaleChanged,
  settledScale,
  TILE_PX,
  tileBounds,
  tileId,
  tilesIn,
  tileSpan,
} from './grid';
export type { TileRange } from './grid';
export { inkBounds } from './inkBox';
export { dirtyRect, invalidate } from './invalidate';
export type { DeviceRect, Invalidation, InvalidationResult, TileDirty } from './invalidate';
export { AHEAD_TILES, FAST_SCROLL, planTiles, visibleTileCount } from './planner';
export type { PlanInput, TileBudget, TileInfo, TileJob, TilePlan, TilePriority, TileStatus } from './planner';
