// Zoom levels for the page view: the steps, the limits, wheel and pinch gestures, and the zoom that fits a sheet to the
// window. A zoom is a factor, where 1 is actual size, to match the zoom a page's view state stores.

/** The stored zoom range is 0.1 to 10. The page view offers a narrower one that stays usable. */
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;
export const ACTUAL_SIZE = 1;

/** The steps of the zoom commands, from 25% to 400%. The first nine are the steps of the page zoom in Phase 2. */
export const ZOOM_STEPS: readonly number[] = [0.25, 0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2, 3, 4];

/** A pinch or wheel this close to actual size snaps to it, so 100% is easy to hit. */
export const SNAP_RANGE = 0.04;
/** How much one wheel notch (a deltaY of 100) zooms. */
const WHEEL_RATE = 0.0015;
/** Pixels in one line, for wheels that report lines. */
const LINE_PIXELS = 16;
/** The gap kept around a sheet that is fitted to the window, in CSS pixels. */
export const FIT_PADDING = 24;

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return ACTUAL_SIZE;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/** The zoom as a whole percent, for display. */
export function percent(zoom: number): number {
  return Math.round(zoom * 100);
}

/**
 * The next step above or below the current zoom, stopping at the ends. It works from any zoom, including one a fit
 * command produced that is between two steps.
 */
export function stepZoom(current: number, direction: 1 | -1): number {
  const eps = 1e-6;
  const at = clampZoom(current);
  if (direction === 1) return ZOOM_STEPS.find((s) => s > at + eps) ?? ZOOM_MAX;
  return [...ZOOM_STEPS].reverse().find((s) => s < at - eps) ?? ZOOM_MIN;
}

function snap(zoom: number): number {
  return Math.abs(zoom - ACTUAL_SIZE) <= SNAP_RANGE ? ACTUAL_SIZE : zoom;
}

/** The zoom after a Ctrl+wheel event. `mode` is the event's deltaMode: 0 pixels, 1 lines, 2 pages. */
export function wheelZoom(current: number, deltaY: number, mode = 0): number {
  const pixels = mode === 1 ? deltaY * LINE_PIXELS : mode === 2 ? deltaY * 400 : deltaY;
  return snap(clampZoom(clampZoom(current) * Math.exp(-pixels * WHEEL_RATE)));
}

/** The zoom during a pinch, from the zoom and finger distance when it began. */
export function pinchZoom(startZoom: number, startDistance: number, distance: number): number {
  if (!(startDistance > 0) || !(distance > 0)) return clampZoom(startZoom);
  return snap(clampZoom(startZoom * (distance / startDistance)));
}

/** The zoom at which `size` page units, plus padding on both sides, fill `available` CSS pixels. */
function fit(size: number, available: number, padding: number): number {
  const room = available - 2 * padding;
  return size > 0 && room > 0 ? room / size : ZOOM_MIN;
}

/** The zoom at which a sheet's width fills the window. */
export function fitWidth(viewport: Viewport, sheetWidth: number, padding = FIT_PADDING): number {
  return clampZoom(fit(sheetWidth, viewport.width, padding));
}

/** The zoom at which a whole sheet shows. */
export function fitSheet(viewport: Viewport, sheetWidth: number, sheetHeight: number, padding = FIT_PADDING): number {
  return clampZoom(Math.min(fit(sheetWidth, viewport.width, padding), fit(sheetHeight, viewport.height, padding)));
}

/** The zoom at which `count` sheets stand side by side (a spread), with `gap` page units between them. */
export function fitSpread(
  viewport: Viewport,
  sheetWidth: number,
  sheetHeight: number,
  count: number,
  gap: number,
  padding = FIT_PADDING,
): number {
  const width = count * sheetWidth + Math.max(0, count - 1) * gap;
  return clampZoom(Math.min(fit(width, viewport.width, padding), fit(sheetHeight, viewport.height, padding)));
}

/**
 * The zoom a page opens at the first time: actual size when the sheet's width fits, else the zoom that fits the width,
 * but never below 50%. A sheet still wider than the window then scrolls sideways.
 */
export function openingZoom(viewport: Viewport, sheetWidth: number): number {
  return Math.max(0.5, Math.min(ACTUAL_SIZE, fitWidth(viewport, sheetWidth)));
}
