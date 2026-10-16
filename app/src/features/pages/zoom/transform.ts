// The view onto a page: which page position sits at the window's top-left corner, and the zoom. Positions are page
// units, so zooming never changes what a stored scroll means. Switching between infinite and paginated view keeps
// both numbers unless the new view's limits force a change, which is how content under the pointer stays still.

import type { Rect, SheetGeometry } from '../pagination/geometry';
import type { ViewMode } from '../layout/view';
import { clampZoom, FIT_PADDING, type Viewport } from './zoom';

export interface View {
  readonly zoom: number;
  /** The page position at the window's top-left corner. Negative when the window shows space left of the paper. */
  readonly left: number;
  readonly top: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** The part of the page the window may show, in page units. */
export interface Bounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export function pageToScreen(view: View, p: Point): Point {
  return { x: (p.x - view.left) * view.zoom, y: (p.y - view.top) * view.zoom };
}

export function screenToPage(view: View, s: Point): Point {
  return { x: view.left + s.x / view.zoom, y: view.top + s.y / view.zoom };
}

/**
 * Zooms about a window position: the page position under `anchor` (in CSS pixels from the window's top-left) stays
 * under it. Use the pointer for a wheel or pinch, and the window's center for a command.
 */
export function zoomAt(view: View, zoom: number, anchor: Point): View {
  const next = clampZoom(zoom);
  const page = screenToPage(view, anchor);
  return { zoom: next, left: page.x - anchor.x / next, top: page.y - anchor.y / next };
}

/** The window center, the anchor for zoom commands. */
export function centerOf(viewport: Viewport): Point {
  return { x: viewport.width / 2, y: viewport.height / 2 };
}

/**
 * What the window may show. Both modes share the horizontal range: the paper's width, widened to take in content that
 * lies off the paper. Infinite view adds a sheet of blank space below the content to write in. Paginated view
 * ends at the last sheet.
 */
export function boundsFor(mode: ViewMode, g: SheetGeometry, sheets: number, content?: Rect | null): Bounds {
  const bottom = Math.max(sheets * g.height, content ? content.y + content.h : 0);
  return {
    left: Math.min(0, content?.x ?? 0),
    top: Math.min(0, content?.y ?? 0),
    right: Math.max(g.width, content ? content.x + content.w : 0),
    bottom: mode === 'infinite' ? bottom + g.height : bottom,
  };
}

function clampAxis(start: number, size: number, min: number, max: number, pad: number): number {
  const lo = min - pad;
  const hi = max + pad;
  // Content that fits the window is centered, so a narrow sheet sits in the middle of a wide window.
  if (hi - lo <= size) return (lo + hi) / 2 - size / 2;
  return Math.min(Math.max(start, lo), hi - size);
}

/** Keeps the view within the bounds, with a small margin. Content smaller than the window is centered. */
export function clampView(view: View, viewport: Viewport, bounds: Bounds, padding = FIT_PADDING): View {
  const pad = padding / view.zoom;
  return {
    zoom: view.zoom,
    left: clampAxis(view.left, viewport.width / view.zoom, bounds.left, bounds.right, pad),
    top: clampAxis(view.top, viewport.height / view.zoom, bounds.top, bounds.bottom, pad),
  };
}

export interface Switched {
  readonly view: View;
  /** How far the content moved on the screen, in CSS pixels. Zero when the limits allowed the same view. */
  readonly moved: number;
}

/**
 * The view after switching between infinite and paginated. Zoom and position stay as they were, so the content under
 * the pointer stays under it, unless the new mode's bounds put the position out of range.
 */
export function switchView(view: View, viewport: Viewport, to: Bounds): Switched {
  const next = clampView(view, viewport, to);
  const moved = Math.hypot((next.left - view.left) * view.zoom, (next.top - view.top) * view.zoom);
  return { view: next, moved };
}

/** A view that shows `rect` centered, at the given zoom. */
export function viewCentered(rect: Rect, zoom: number, viewport: Viewport): View {
  const z = clampZoom(zoom);
  return {
    zoom: z,
    left: rect.x + rect.w / 2 - viewport.width / z / 2,
    top: rect.y + rect.h / 2 - viewport.height / z / 2,
  };
}
