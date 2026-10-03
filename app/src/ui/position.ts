// Keeps an overlay on screen (ARCHITECTURE.md section 15.3). Context menus open at the pointer, or below the
// focused element for the keyboard. An overlay that would pass an edge of the window flips to the other side of
// its point, then clamps, so it always stays fully visible.

import { tokens } from '../theme/tokens';

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** The gap an overlay keeps from the window's edges. */
export const EDGE_MARGIN = tokens.space[3];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)));
}

function viewport(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

/** Where to put an overlay's start corner so it opens at `point` and stays inside the window. */
export function placeAtPoint(point: Point, size: Size, view: Size = viewport(), margin = EDGE_MARGIN): Point {
  const flipX = point.x + size.width + margin > view.width;
  const flipY = point.y + size.height + margin > view.height;
  return {
    x: clamp(flipX ? point.x - size.width : point.x, margin, view.width - size.width - margin),
    y: clamp(flipY ? point.y - size.height : point.y, margin, view.height - size.height - margin),
  };
}

/** Beside an element, such as the item that opened a submenu, on its end side or its start side. */
export function placeBeside(rect: DOMRectReadOnly, size: Size, view: Size = viewport(), margin = EDGE_MARGIN): Point {
  const after = rect.right + size.width + margin <= view.width;
  return {
    x: clamp(after ? rect.right : rect.left - size.width, margin, view.width - size.width - margin),
    y: clamp(rect.top, margin, view.height - size.height - margin),
  };
}

/** Below an element's start edge, or above it when there is no room below. */
export function placeBelow(rect: DOMRectReadOnly, size: Size, view: Size = viewport(), margin = EDGE_MARGIN): Point {
  const below = rect.bottom + size.height + margin <= view.height;
  const y = below ? rect.bottom : rect.top - size.height;
  return {
    x: clamp(rect.left, margin, view.width - size.width - margin),
    y: clamp(y, margin, view.height - size.height - margin),
  };
}
