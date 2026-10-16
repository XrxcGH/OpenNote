// Pressure and tilt to width (architecture 6.3). The outline code gives perfect-freehand one nominal size and a
// pressure per point. Its radius at a point is `size * (0.5 - thinning * (0.5 - pressure))`. These functions give
// the same diameter without building an outline. The hover cursor, the pressure meter, and the preview pad use them,
// and so do boxes that must hold the widest part of a stroke. A test checks them against the real outline.

import { PENCIL_MAX_TILT_WIDTH, pencilWidthFactor, toolThinning } from '../geometry/outline';
import type { InkPoint, InkTool } from '../geometry/types';

/** The pressure a pen reports when it has none: the middle of the range, which draws at the nominal width. */
export const NEUTRAL_PRESSURE = 0.5;

export interface WidthOptions {
  /** The transform's width scale (`widthScale`). Defaults to 1. */
  readonly scale?: number;
  /** False for a mouse or touch stroke, which has no pressure and draws at the nominal width. Defaults to true. */
  readonly pressure?: boolean;
}

/** The drawn diameter at one point, in page units. */
export function widthAt(tool: InkTool, nominal: number, point: InkPoint, options: WidthOptions = {}): number {
  const size = nominal * (options.scale ?? 1);
  const thinning = options.pressure === false ? 0 : toolThinning(tool);
  if (thinning === 0) return size;
  const pressure = Math.min(1, Math.max(0, point.pressure ?? NEUTRAL_PRESSURE));
  const fromPressure = 1 - 2 * thinning * (0.5 - pressure);
  return size * fromPressure * (tool === 'pencil' ? pencilWidthFactor(point) : 1);
}

/** The thinnest a stroke of this tool gets, as a share of its nominal width: pressure 0, pencil upright. */
export function minWidthFactor(tool: InkTool): number {
  return 1 - toolThinning(tool);
}

/** The widest a stroke of this tool gets, as a share of its nominal width: pressure 1, pencil lying flat. */
export function maxWidthFactor(tool: InkTool): number {
  const fromPressure = 1 + toolThinning(tool);
  return tool === 'pencil' ? fromPressure * PENCIL_MAX_TILT_WIDTH : fromPressure;
}

/** The pressure that draws a given share of the nominal width, or null when the tool ignores pressure. */
export function pressureForFactor(tool: InkTool, factor: number): number | null {
  const thinning = toolThinning(tool);
  if (thinning === 0) return null;
  return Math.min(1, Math.max(0, 0.5 + (factor - 1) / (2 * thinning)));
}

export const MIN_CURSOR_PX = 3;
export const MAX_CURSOR_PX = 32;
export const MAX_ERASER_CURSOR_PX = 128;

export interface HoverPreview {
  /** The circle's diameter in screen pixels. */
  readonly diameter: number;
  /** True when the size passed the cursor limit, so the live canvas draws a ring instead of a CSS cursor. */
  readonly ring: boolean;
}

/** The pen-tip circle for the hover cursor: the nominal width at the zoom, kept to 3 to 32 pixels (design 5.7). */
export function penHoverPreview(nominal: number, zoom: number): HoverPreview {
  const px = nominal * zoom;
  return { diameter: Math.min(MAX_CURSOR_PX, Math.max(MIN_CURSOR_PX, px)), ring: false };
}

/** The eraser circle for the hover cursor: up to 128 pixels as a cursor, and larger sizes draw a ring. */
export function eraserHoverPreview(radius: number, zoom: number): HoverPreview {
  const diameter = radius * 2 * zoom;
  return diameter <= MAX_ERASER_CURSOR_PX
    ? { diameter: Math.max(MIN_CURSOR_PX, diameter), ring: false }
    : { diameter, ring: true };
}
