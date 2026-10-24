// Viewport math: moving between graph coordinates and pixels, panning, and zooming. Every function returns a new
// viewport. The graph's y axis points up and the screen's points down, so conversions flip y.

import type { Pixel, Point, Size, Viewport } from './types';

/** The smallest and largest span of an axis. Outside this range, floating-point numbers lose too much precision. */
export const MIN_SPAN = 1e-9;
export const MAX_SPAN = 1e9;

/** How much one wheel notch (a delta of 100) zooms: the graph grows by about this factor per notch. */
export const WHEEL_ZOOM_PER_NOTCH = 1.25;

export type ZoomAxes = 'both' | 'x' | 'y';

export function spanX(view: Viewport): number {
  return view.xMax - view.xMin;
}

export function spanY(view: Viewport): number {
  return view.yMax - view.yMin;
}

/** A viewport of unit-square cells: `width` units wide, centered on the origin, with y sized to fit `size`. */
export function defaultViewport(size: Size, width = 20): Viewport {
  const height = (width * size.height) / size.width;
  return { xMin: -width / 2, xMax: width / 2, yMin: -height / 2, yMax: height / 2 };
}

export function toPixel(view: Viewport, size: Size, point: Point): Pixel {
  return {
    x: ((point.x - view.xMin) / spanX(view)) * size.width,
    y: ((view.yMax - point.y) / spanY(view)) * size.height,
  };
}

export function toWorld(view: Viewport, size: Size, pixel: Pixel): Point {
  return {
    x: view.xMin + (pixel.x / size.width) * spanX(view),
    y: view.yMax - (pixel.y / size.height) * spanY(view),
  };
}

/** Pixels per graph unit on each axis. */
export function scaleOf(view: Viewport, size: Size): { x: number; y: number } {
  return { x: size.width / spanX(view), y: size.height / spanY(view) };
}

function clampSpan(span: number): number {
  return Math.min(MAX_SPAN, Math.max(MIN_SPAN, span));
}

/** Drags the graph by a number of pixels: the content follows the pointer, so the view moves the other way. */
export function panByPixels(view: Viewport, size: Size, dx: number, dy: number): Viewport {
  const { x, y } = scaleOf(view, size);
  return {
    xMin: view.xMin - dx / x,
    xMax: view.xMax - dx / x,
    yMin: view.yMin + dy / y,
    yMax: view.yMax + dy / y,
  };
}

/** The keyboard version of a drag: moves by a fraction of the view, so 0.25 to the right shows the next quarter. */
export function panByFraction(view: Viewport, right: number, up: number): Viewport {
  const dx = right * spanX(view);
  const dy = up * spanY(view);
  return { xMin: view.xMin + dx, xMax: view.xMax + dx, yMin: view.yMin + dy, yMax: view.yMax + dy };
}

function zoomRange(min: number, max: number, anchor: number, factor: number): [number, number] {
  const span = max - min;
  const next = clampSpan(span / factor);
  const fraction = (anchor - min) / span;
  const start = anchor - fraction * next;
  return [start, start + next];
}

/** Zooms by `factor` (above 1 zooms in) and keeps the graph point under `anchor` where it is on screen. */
export function zoomAround(view: Viewport, anchor: Point, factor: number, axes: ZoomAxes = 'both'): Viewport {
  if (!(factor > 0) || !Number.isFinite(factor)) return view;
  const [xMin, xMax] = axes === 'y' ? [view.xMin, view.xMax] : zoomRange(view.xMin, view.xMax, anchor.x, factor);
  const [yMin, yMax] = axes === 'x' ? [view.yMin, view.yMax] : zoomRange(view.yMin, view.yMax, anchor.y, factor);
  return { xMin, xMax, yMin, yMax };
}

/** Zooms about the center of the view, for the plus and minus buttons and keys. */
export function zoomAtCenter(view: Viewport, factor: number): Viewport {
  const center = { x: (view.xMin + view.xMax) / 2, y: (view.yMin + view.yMax) / 2 };
  return zoomAround(view, center, factor);
}

/** The zoom factor for a wheel event, so that opposite scrolls undo each other exactly. */
export function wheelZoomFactor(deltaY: number): number {
  return Math.pow(WHEEL_ZOOM_PER_NOTCH, -deltaY / 100);
}

/** The view that shows the box between two pixels, for a drag-to-zoom rectangle. Ignores a box with no area. */
export function zoomToBox(view: Viewport, size: Size, a: Pixel, b: Pixel): Viewport {
  if (a.x === b.x || a.y === b.y) return view;
  const first = toWorld(view, size, a);
  const second = toWorld(view, size, b);
  return {
    xMin: Math.min(first.x, second.x),
    xMax: Math.max(first.x, second.x),
    yMin: Math.min(first.y, second.y),
    yMax: Math.max(first.y, second.y),
  };
}

/** The view with square cells, where one unit is as long on y as on x. It keeps the center and the old area. */
export function squareCells(view: Viewport, size: Size): Viewport {
  const { x, y } = scaleOf(view, size);
  const scale = Math.min(x, y);
  const width = size.width / scale;
  const height = size.height / scale;
  const cx = (view.xMin + view.xMax) / 2;
  const cy = (view.yMin + view.yMax) / 2;
  return { xMin: cx - width / 2, xMax: cx + width / 2, yMin: cy - height / 2, yMax: cy + height / 2 };
}

/** The view after the drawing area changes size, keeping the scale (pixels per unit) and the top left corner. */
export function resizeKeepingScale(view: Viewport, from: Size, to: Size): Viewport {
  const { x, y } = scaleOf(view, from);
  return { xMin: view.xMin, xMax: view.xMin + to.width / x, yMax: view.yMax, yMin: view.yMax - to.height / y };
}
