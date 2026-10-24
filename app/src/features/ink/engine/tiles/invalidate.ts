// Tile invalidation (architecture 7.6). When ink changes, only the tiles that meet its box need drawing again, and
// within a tile only a dirty rectangle: the box grown by 1 device pixel, snapped outward to whole device pixels, and
// clipped to the tile. Drawing is deterministic, so a redraw of a dirty rectangle equals the same area of a full
// tile render pixel for pixel. A theme change makes every tile stale, so it bumps the revision and the planner
// refills them, visible tiles first.

import { intersects } from '../../geometry/bounds';
import type { Bounds } from '../../geometry/types';
import { eachTile, growRange, TILE_PX, tileBounds, tilesIn, tileId } from './grid';
import type { TileInfo } from './planner';

/** A rectangle in device pixels, relative to the tile's top-left corner. */
export interface DeviceRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type Invalidation =
  /** A stroke was added. `onTop` is true for the newest stroke of the topmost ink block, which draws over the tile. */
  | { readonly kind: 'added'; readonly box: Bounds; readonly onTop?: boolean }
  /** Strokes were removed by an eraser, a delete, or an undo. */
  | { readonly kind: 'removed'; readonly box: Bounds }
  /** A color or width changed. */
  | { readonly kind: 'restyled'; readonly box: Bounds }
  /** Strokes moved, resized, or were pushed by inserted space. Both places need drawing. */
  | { readonly kind: 'transformed'; readonly before: Bounds; readonly after: Bounds }
  /** The theme, the page color, or the contrast setting changed. */
  | { readonly kind: 'theme' };

export interface TileDirty {
  readonly id: string;
  readonly tx: number;
  readonly ty: number;
  /** One rectangle that covers everything that changed in the tile. */
  readonly rect: DeviceRect;
  /** True when the change only adds ink on top, so the engine can draw the new strokes without clearing. */
  readonly onTop: boolean;
  /** True when the tile had no ink and now needs a canvas. */
  readonly wasEmpty: boolean;
}

export interface InvalidationResult {
  readonly dirty: TileDirty[];
  /** True when every tile is stale, so the plan's revision must go up. */
  readonly all: boolean;
}

/** The dirty rectangle of a page box in one tile, or null when the box misses the tile. */
export function dirtyRect(box: Bounds, scale: number, tx: number, ty: number): DeviceRect | null {
  const tile = tileBounds(tx, ty, scale);
  const x0 = Math.max(0, Math.floor((box.minX - tile.minX) * scale - 1));
  const y0 = Math.max(0, Math.floor((box.minY - tile.minY) * scale - 1));
  const x1 = Math.min(TILE_PX, Math.ceil((box.maxX - tile.minX) * scale + 1));
  const y1 = Math.min(TILE_PX, Math.ceil((box.maxY - tile.minY) * scale + 1));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

function union(a: DeviceRect, b: DeviceRect): DeviceRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

interface Accumulated {
  rect: DeviceRect;
  onTop: boolean;
}

/** The boxes an event touches, and whether it only adds ink on top. */
function boxesOf(event: Exclude<Invalidation, { kind: 'theme' }>): { boxes: Bounds[]; onTop: boolean } {
  switch (event.kind) {
    case 'added':
      return { boxes: [event.box], onTop: event.onTop !== false };
    case 'transformed':
      return { boxes: [event.before, event.after], onTop: false };
    default:
      return { boxes: [event.box], onTop: false };
  }
}

/**
 * The tiles to redraw for a batch of changes. Only tiles that exist at the given scale are listed: tiles that are not
 * drawn yet will be drawn whole when the planner asks for them.
 */
export function invalidate(
  tiles: ReadonlyMap<string, TileInfo>,
  scale: number,
  events: readonly Invalidation[],
): InvalidationResult {
  const found = new Map<string, Accumulated>();
  let all = false;
  for (const event of events) {
    if (event.kind === 'theme') {
      all = true;
      continue;
    }
    const { boxes, onTop } = boxesOf(event);
    for (const box of boxes) collect(tiles, scale, box, onTop, found);
  }
  const dirty: TileDirty[] = [];
  for (const [id, { rect, onTop }] of found) {
    const info = tiles.get(id)!;
    dirty.push({ id, tx: info.tx, ty: info.ty, rect, onTop, wasEmpty: info.status === 'empty' });
  }
  return { dirty, all };
}

function collect(
  tiles: ReadonlyMap<string, TileInfo>,
  scale: number,
  box: Bounds,
  onTop: boolean,
  found: Map<string, Accumulated>,
): void {
  const reach = growRange(tilesIn(box, scale), 1);
  eachTile(reach, (tx, ty) => {
    const id = tileId(scale, tx, ty);
    if (!tiles.has(id) || !intersects(grownBox(box, scale), tileBounds(tx, ty, scale))) return;
    const rect = dirtyRect(box, scale, tx, ty);
    if (!rect) return;
    const before = found.get(id);
    found.set(id, before ? { rect: union(before.rect, rect), onTop: before.onTop && onTop } : { rect, onTop });
  });
}

/** The box grown by one device pixel, in page units. */
function grownBox(box: Bounds, scale: number): Bounds {
  const by = 1 / scale;
  return { minX: box.minX - by, minY: box.minY - by, maxX: box.maxX + by, maxY: box.maxY + by };
}
