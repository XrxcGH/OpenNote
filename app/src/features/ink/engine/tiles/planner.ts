// The tile cache planner (architecture 7.3, 7.5, and 7.8). Given the view, the tiles that exist, and a budget, it says
// which tiles to draw, in what order, which are empty, and which to give back to the pool. It is a pure function of
// its input, so the engine calls it on every camera message and a test can replay a scroll or a zoom.
//
// Priorities follow the scheduler's table. Priority 1 is the visible tiles. Priority 2 is the ring, the rows ahead of
// a fast scroll, and a sharper set after a big zoom-in. Priority 3 refills stale tiles the person cannot see.
// Priority 0 is hand-off and erase redraws, which come from invalidation and not from here.

import { intersects } from '../../geometry/bounds';
import type { Bounds, Vec } from '../../geometry/types';
import {
  eachTile,
  growRange,
  inRange,
  rangeCount,
  scaleChanged,
  settledScale,
  tileBounds,
  tileId,
  tilesIn,
} from './grid';
import type { TileRange } from './grid';

export type TileStatus = 'ready' | 'empty';

/** A tile the engine holds. `empty` tiles have no canvas, because no ink touches them. */
export interface TileInfo {
  readonly scale: number;
  readonly tx: number;
  readonly ty: number;
  readonly status: TileStatus;
  /** The content revision it was drawn at. A lower number than the plan's means the tile is stale. */
  readonly revision: number;
  /** The frame counter when a plan last wanted it, for least-recently-used eviction. */
  readonly lastUsed: number;
}

export interface TileBudget {
  /** The most tiles to keep. Tiles with canvases and tiles marked empty both count. The visible tiles always fit. */
  readonly maxTiles: number;
}

export interface PlanInput {
  /** The visible part of the page, in page units. */
  readonly viewport: Bounds;
  readonly zoom: number;
  readonly devicePixelRatio: number;
  /** True once the zoom has been still for 150 ms. */
  readonly zoomStill: boolean;
  /** The scale of the tile set on screen, or null before the first plan. */
  readonly shownScale: number | null;
  /** The scroll velocity in page units per millisecond. A fast scroll prefetches rows ahead. */
  readonly velocity?: Vec;
  readonly tiles: ReadonlyMap<string, TileInfo>;
  /** The content revision. A theme or page color change bumps it, which makes every tile stale. */
  readonly revision: number;
  /** While a pen is down, only the visible tiles are drawn. */
  readonly penDown: boolean;
  readonly budget: TileBudget;
  /** The frame counter, which stamps the tiles the plan wants. */
  readonly frame: number;
  /** Whether any ink touches a page rectangle. Without it, every tile is drawn. */
  readonly hasInk?: (rect: Bounds) => boolean;
  /** The most jobs to return, nearest first. */
  readonly maxJobs?: number;
}

export type TilePriority = 1 | 2 | 3;

export interface TileJob {
  readonly id: string;
  readonly scale: number;
  readonly tx: number;
  readonly ty: number;
  readonly priority: TilePriority;
}

export interface TilePlan {
  /** The scale tiles are drawn at. */
  readonly scale: number;
  /** Tiles to draw, by priority and then distance from the center of the view. */
  readonly jobs: TileJob[];
  /** Tiles with no ink. The engine marks them ready with no canvas. */
  readonly empty: TileJob[];
  /** Tiles to show now, at the plan's scale. */
  readonly visible: string[];
  /** Tiles to give back to the pool. */
  readonly evict: string[];
  /** True while a visible tile is still missing, so the overview must show under the tiles. */
  readonly overview: boolean;
  /** Tiles held after the plan: those kept and those about to be drawn. */
  readonly retained: number;
}

/** A scroll faster than this, in page units per millisecond, draws rows ahead (500 units a second). */
export const FAST_SCROLL = 0.5;
/** How many tile rows or columns to draw ahead of a fast scroll. */
export const AHEAD_TILES = 2;

function chooseScale(input: PlanInput): { scale: number; sharpen: number | null } {
  const wanted = settledScale(input.zoom, input.devicePixelRatio);
  const shown = input.shownScale;
  if (shown === null) return { scale: wanted, sharpen: null };
  if (input.zoomStill) return { scale: scaleChanged(shown, wanted) ? wanted : shown, sharpen: null };
  // A zoom out at the shown scale would want the view's tiles with the square of the zoom factor, so once that is
  // more than the budget holds, the plan moves to the wanted scale, which always fits.
  if (rangeCount(tilesIn(input.viewport, shown)) > input.budget.maxTiles) return { scale: wanted, sharpen: null };
  // During a zoom gesture no new jobs start, except when the shown tiles fall below half the wanted resolution.
  return { scale: shown, sharpen: shown < wanted / 2 ? wanted : null };
}

/** The extra rows or columns a fast scroll will reach, as a range in the direction of travel. */
function aheadRange(visible: TileRange, velocity: Vec | undefined): TileRange | null {
  if (!velocity || Math.hypot(velocity.x, velocity.y) < FAST_SCROLL) return null;
  if (Math.abs(velocity.y) >= Math.abs(velocity.x)) {
    return velocity.y > 0
      ? { ...visible, y0: visible.y1 + 1, y1: visible.y1 + AHEAD_TILES }
      : { ...visible, y0: visible.y0 - AHEAD_TILES, y1: visible.y0 - 1 };
  }
  return velocity.x > 0
    ? { ...visible, x0: visible.x1 + 1, x1: visible.x1 + AHEAD_TILES }
    : { ...visible, x0: visible.x0 - AHEAD_TILES, x1: visible.x0 - 1 };
}

function isFresh(info: TileInfo | undefined, revision: number): boolean {
  return info !== undefined && info.revision >= revision;
}

class Planner {
  private readonly jobs: TileJob[] = [];
  private readonly empty: TileJob[] = [];
  private readonly wanted = new Set<string>();
  private readonly visible = new Set<string>();
  private missingVisible = false;

  constructor(private readonly input: PlanInput) {}

  /** Wants one tile: draws it, marks it empty, or leaves it alone when it is fresh. */
  want(scale: number, tx: number, ty: number, priority: TilePriority, visible: boolean): void {
    const id = tileId(scale, tx, ty);
    if (this.wanted.has(id)) return;
    this.wanted.add(id);
    if (priority === 1) this.visible.add(id);
    const { tiles, revision, hasInk } = this.input;
    const info = tiles.get(id);
    if (isFresh(info, revision)) return;
    const job: TileJob = { id, scale, tx, ty, priority };
    if (hasInk && !hasInk(tileBounds(tx, ty, scale))) {
      this.empty.push(job);
      return;
    }
    this.jobs.push(job);
    if (visible) this.missingVisible = true;
  }

  wantRange(scale: number, range: TileRange, priority: TilePriority, visible: boolean, skip?: TileRange): void {
    eachTile(range, (tx, ty) => {
      if (!skip || !inRange(skip, tx, ty)) this.want(scale, tx, ty, priority, visible);
    });
  }

  result(): {
    jobs: TileJob[];
    empty: TileJob[];
    wanted: ReadonlySet<string>;
    visible: ReadonlySet<string>;
    missingVisible: boolean;
  } {
    const { jobs, empty, wanted, visible, missingVisible } = this;
    return { jobs, empty, wanted, visible, missingVisible };
  }
}

/** Orders jobs by priority, then by distance from the center of the view. */
function orderJobs(jobs: TileJob[], viewport: Bounds): TileJob[] {
  const cx = (viewport.minX + viewport.maxX) / 2;
  const cy = (viewport.minY + viewport.maxY) / 2;
  const distance = (job: TileJob) => {
    const box = tileBounds(job.tx, job.ty, job.scale);
    return Math.hypot((box.minX + box.maxX) / 2 - cx, (box.minY + box.maxY) / 2 - cy);
  };
  const keyed = jobs.map((job) => ({ job, d: distance(job) }));
  keyed.sort((a, b) => a.job.priority - b.job.priority || a.d - b.d);
  return keyed.map((k) => k.job);
}

interface Evictions {
  readonly evict: string[];
  /** Tiles that nothing wants and that stay, as the hidden cache. */
  readonly kept: TileInfo[];
}

/**
 * Chooses the tiles to give back. Tiles at another scale go once the plan's set covers the view; until then the ones
 * on screen stay and count as visible, so the view never drops to the overview at a scale switch. Tiles that nothing
 * wants go, oldest first, when the total is over budget. Wanted tiles are never evicted. The room left counts the
 * wanted tiles that will be held: those held now and the visible ones, but not missing ring or refill tiles, which
 * the trim drops when they don't fit.
 */
function chooseEvictions(
  input: PlanInput,
  scale: number,
  wanted: ReadonlySet<string>,
  covered: boolean,
  reserved: number,
): Evictions {
  const evict: string[] = [];
  let kept: TileInfo[] = [];
  let onScreen = 0;
  for (const [id, info] of input.tiles) {
    if (wanted.has(id)) continue;
    if (info.scale !== scale && covered) evict.push(id);
    else if (info.scale !== scale && intersects(tileBounds(info.tx, info.ty, info.scale), input.viewport)) onScreen++;
    else kept.push(info);
  }
  const room = Math.max(0, input.budget.maxTiles - reserved - onScreen);
  if (kept.length > room) {
    kept.sort((a, b) => a.lastUsed - b.lastUsed);
    for (const info of kept.slice(0, kept.length - room)) evict.push(tileId(info.scale, info.tx, info.ty));
    kept = kept.slice(kept.length - room);
  }
  return { evict, kept };
}

/** Drops the lowest-priority jobs until the plan fits the budget. The visible tiles always stay. */
function trimToBudget(jobs: TileJob[], held: number, maxTiles: number): TileJob[] {
  let over = held - maxTiles;
  const out = [...jobs];
  while (over > 0 && out.length > 0 && out[out.length - 1].priority > 1) {
    out.pop();
    over--;
  }
  return out;
}

/** Priority 3: tiles at the plan's scale that are held but stale and outside the ring. They refill when idle. */
function wantStale(planner: Planner, kept: readonly TileInfo[], scale: number, revision: number): void {
  for (const info of kept) {
    if (info.scale === scale && info.status === 'ready' && !isFresh(info, revision)) {
      planner.want(scale, info.tx, info.ty, 3, false);
    }
  }
}

function visibleIds(input: PlanInput, scale: number, range: TileRange): string[] {
  const ids: string[] = [];
  eachTile(range, (tx, ty) => {
    const id = tileId(scale, tx, ty);
    if (input.tiles.has(id)) ids.push(id);
  });
  return ids;
}

/** Plans the tiles for one camera state. */
export function planTiles(input: PlanInput): TilePlan {
  const { scale, sharpen } = chooseScale(input);
  const visibleRange = tilesIn(input.viewport, scale);
  const planner = new Planner(input);
  planner.wantRange(scale, visibleRange, 1, true);
  if (sharpen !== null) planner.wantRange(sharpen, tilesIn(input.viewport, sharpen), 2, false);
  if (!input.penDown) {
    planner.wantRange(scale, growRange(visibleRange, 1), 2, false, visibleRange);
    const ahead = aheadRange(visibleRange, input.velocity);
    if (ahead) planner.wantRange(scale, ahead, 2, false);
  }
  const core = planner.result();
  const covered = !core.missingVisible && sharpen === null;
  let reserved = 0;
  for (const id of core.wanted) {
    if (input.tiles.has(id) || core.visible.has(id)) reserved++;
  }
  const { evict, kept } = chooseEvictions(input, scale, core.wanted, covered, reserved);
  if (!input.penDown) wantStale(planner, kept, scale, input.revision);
  const all = planner.result();
  const ordered = orderJobs(all.jobs, input.viewport);
  const held = all.wanted.size + kept.filter((info) => !all.wanted.has(tileId(info.scale, info.tx, info.ty))).length;
  const jobs = trimToBudget(ordered, held, input.budget.maxTiles).slice(0, input.maxJobs ?? Infinity);
  const retained = held - (ordered.length - trimToBudget(ordered, held, input.budget.maxTiles).length);
  return {
    scale,
    jobs,
    empty: all.empty,
    visible: visibleIds(input, scale, visibleRange),
    evict,
    overview: all.missingVisible,
    retained,
  };
}

/** How many tiles the view needs, which sizes a budget. */
export function visibleTileCount(viewport: Bounds, scale: number): number {
  return rangeCount(tilesIn(viewport, scale));
}
