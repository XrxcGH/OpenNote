// The tile grid (architecture 7.3). A tile is 256 by 256 device pixels. A tile set has a scale `L` in device pixels per
// page unit, and tile (tx, ty) covers 256 / L page units from (tx * 256 / L, ty * 256 / L). Indices are signed, so an
// infinite page works in every direction. Nothing here touches a canvas.

import type { Bounds } from '../../geometry/types';

export const TILE_PX = 256;
/** The lowest and highest tile scale: 1/16 and 8 device pixels per page unit. */
export const MIN_SCALE = 1 / 16;
export const MAX_SCALE = 8;
/** Tiles are redrawn only when the shown scale differs from the settled one by more than this share. */
export const SCALE_TOLERANCE = 0.07;
/** One tile's pixels: 256 KiB. */
export const BYTES_PER_TILE = TILE_PX * TILE_PX * 4;

/** An inclusive range of tile indices. A range with `x1 < x0` or `y1 < y0` is empty. */
export interface TileRange {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** The scale name in a tile id. Scales are compared by this text, so equal scales always match. */
export function scaleKey(scale: number): string {
  return scale.toFixed(4);
}

export function tileId(scale: number, tx: number, ty: number): string {
  return `${scaleKey(scale)}|${tx},${ty}`;
}

/** The page size of a tile's side at a scale. */
export function tileSpan(scale: number): number {
  return TILE_PX / scale;
}

/** A tile's rectangle in page units. */
export function tileBounds(tx: number, ty: number, scale: number): Bounds {
  const span = tileSpan(scale);
  return { minX: tx * span, minY: ty * span, maxX: (tx + 1) * span, maxY: (ty + 1) * span };
}

/** The tiles a page rectangle touches. A rectangle that ends exactly on a tile edge does not reach the next tile. */
export function tilesIn(rect: Bounds, scale: number): TileRange {
  const span = tileSpan(scale);
  const x0 = Math.floor(rect.minX / span);
  const y0 = Math.floor(rect.minY / span);
  return {
    x0,
    y0,
    x1: Math.max(x0, Math.ceil(rect.maxX / span) - 1),
    y1: Math.max(y0, Math.ceil(rect.maxY / span) - 1),
  };
}

export function rangeCount(range: TileRange): number {
  return range.x1 < range.x0 || range.y1 < range.y0 ? 0 : (range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1);
}

export function growRange(range: TileRange, by: number): TileRange {
  return { x0: range.x0 - by, y0: range.y0 - by, x1: range.x1 + by, y1: range.y1 + by };
}

export function inRange(range: TileRange, tx: number, ty: number): boolean {
  return tx >= range.x0 && tx <= range.x1 && ty >= range.y0 && ty <= range.y1;
}

/** Calls `visit` for each tile in a range, row by row. */
export function eachTile(range: TileRange, visit: (tx: number, ty: number) => void): void {
  for (let ty = range.y0; ty <= range.y1; ty++) {
    for (let tx = range.x0; tx <= range.x1; tx++) visit(tx, ty);
  }
}

/** The scale tiles settle at once the zoom has been still: exactly zoom times the pixel ratio, kept to 1/16 to 8. */
export function settledScale(zoom: number, devicePixelRatio: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, zoom * devicePixelRatio));
}

/** True when the shown scale differs from the wanted one by more than 7 percent, so the tiles need redrawing. */
export function scaleChanged(shown: number, wanted: number): boolean {
  return Math.abs(shown / wanted - 1) > SCALE_TOLERANCE;
}
