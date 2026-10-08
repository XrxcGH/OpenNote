// The zoom writing box's coordinates (architecture 12.3). A strip docks at the bottom of the page pane. The person
// writes large in the strip, and the ink lands small in a box on the page. The strip is a second input surface with
// its own mapping from strip pixels to page units. Magnification 2, 3 (the default), or 4 sets the box's size: the
// strip's size divided by the magnification, and by the page zoom, because the box is drawn in page units.

import type { Bounds, Vec } from '../geometry/types';

export type Magnification = 2 | 3 | 4;
export const DEFAULT_MAGNIFICATION: Magnification = 3;
export const MAGNIFICATIONS: readonly Magnification[] = [2, 3, 4];

/** The strip's share of the pane height, and its limits in pixels. */
export const STRIP_SHARE = 0.3;
export const STRIP_MIN_PX = 160;
export const STRIP_MAX_PX = 320;

/** The strip on screen, in client pixels. */
export interface Strip {
  readonly origin: Vec;
  readonly width: number;
  readonly height: number;
}

/** The box on the page, in page units. `origin` is its top-left corner. */
export interface ZoomBox {
  readonly origin: Vec;
  readonly width: number;
  readonly height: number;
}

/** The strip's height for a pane: 30 percent of it, within the limits of 160 to 320 pixels. */
export function stripHeight(paneHeight: number): number {
  return Math.min(STRIP_MAX_PX, Math.max(STRIP_MIN_PX, paneHeight * STRIP_SHARE));
}

/** Screen pixels the strip shows for one page unit: the page zoom times the magnification. */
export function stripScale(magnification: Magnification, zoom: number): number {
  return magnification * zoom;
}

/** The size of the box for a strip, in page units. */
export function boxSize(strip: Pick<Strip, 'width' | 'height'>, magnification: Magnification, zoom: number) {
  const scale = stripScale(magnification, zoom);
  return { width: strip.width / scale, height: strip.height / scale };
}

/** A box of the right size with its top-left corner at a page point. */
export function boxAt(
  origin: Vec,
  strip: Pick<Strip, 'width' | 'height'>,
  magnification: Magnification,
  zoom: number,
): ZoomBox {
  return { origin, ...boxSize(strip, magnification, zoom) };
}

/** The page point under a strip point: the box's origin plus the offset in the strip, divided by the scale. */
export function stripToPage(point: Vec, strip: Strip, box: ZoomBox, magnification: Magnification, zoom: number): Vec {
  const scale = stripScale(magnification, zoom);
  return { x: box.origin.x + (point.x - strip.origin.x) / scale, y: box.origin.y + (point.y - strip.origin.y) / scale };
}

/** The strip point where a page point appears. It is the inverse of `stripToPage`. */
export function pageToStrip(point: Vec, strip: Strip, box: ZoomBox, magnification: Magnification, zoom: number): Vec {
  const scale = stripScale(magnification, zoom);
  return { x: strip.origin.x + (point.x - box.origin.x) * scale, y: strip.origin.y + (point.y - box.origin.y) * scale };
}

export function boxBounds(box: ZoomBox): Bounds {
  return { minX: box.origin.x, minY: box.origin.y, maxX: box.origin.x + box.width, maxY: box.origin.y + box.height };
}

/** The pixel width of a pen's line in the strip, for the strip's live canvas: the page width times the scale. */
export function stripWidth(pageWidth: number, magnification: Magnification, zoom: number): number {
  return pageWidth * stripScale(magnification, zoom);
}
