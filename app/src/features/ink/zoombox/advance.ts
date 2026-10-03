// Moving the zoom writing box along the line (architecture 12.3). After the pen lifts, if the last stroke reached the
// right quarter of the box, the box moves right by half its width after 300 ms, so a dot or a crossbar can come first.
// At the right margin it wraps to the next line, which is the paper's ruling, or 1.25 times the box's height. The
// page scrolls to keep the box in view. Next, New line, and the arrow keys do the same by hand.

import type { Bounds, Vec } from '../geometry/types';
import { boxBounds } from './mapping';
import type { ZoomBox } from './mapping';

/** How long after the pen lifts the box waits before it moves, so a dot or a crossbar can come first. */
export const ADVANCE_DELAY_MS = 300;
/** The last stroke counts as reaching the edge when it ends within this share of the box's width from the right. */
export const EDGE_SHARE = 0.25;
/** The box moves right by this share of its width. */
export const STEP_SHARE = 0.5;
/** Without a ruling, a new line is this many box heights down. */
export const LINE_FACTOR = 1.25;

/** The left and right ends of the line the box writes on: the paper's margins, the text column, or the view. */
export interface Margins {
  readonly left: number;
  readonly right: number;
}

/** The distance from one line to the next: the paper's ruling when there is one, else 1.25 box heights. */
export function lineStep(box: ZoomBox, ruling?: number): number {
  return ruling !== undefined && ruling > 0 ? ruling : box.height * LINE_FACTOR;
}

/** True when the last stroke ended in the right quarter of the box, so the box should move on. */
export function shouldAdvance(box: ZoomBox, stroke: Bounds): boolean {
  const right = box.origin.x + box.width;
  return stroke.maxX >= right - EDGE_SHARE * box.width;
}

export interface Move {
  readonly box: ZoomBox;
  /** True when the box went to the next line. */
  readonly wrapped: boolean;
}

function withOrigin(box: ZoomBox, origin: Vec): ZoomBox {
  return { ...box, origin };
}

/** Starts the next line at the left margin. */
export function newLine(box: ZoomBox, margins: Margins, ruling?: number): ZoomBox {
  return withOrigin(box, { x: margins.left, y: box.origin.y + lineStep(box, ruling) });
}

/** Moves the box right by half its width, or to the next line when that would pass the right margin. */
export function advance(box: ZoomBox, margins: Margins, ruling?: number): Move {
  const next = box.origin.x + box.width * STEP_SHARE;
  if (next + box.width > margins.right && box.origin.x > margins.left) {
    return { box: newLine(box, margins, ruling), wrapped: true };
  }
  return { box: withOrigin(box, { x: next, y: box.origin.y }), wrapped: false };
}

export type BoxKey = 'left' | 'right' | 'up' | 'down' | 'home' | 'end';

/**
 * Where an arrow key, Home, or End puts the box. Arrows move it a quarter of its width or one line. Home goes to the
 * left margin, and End goes to the right end of the ink on the line (`inkRight`), or to the margin when the line is
 * empty. The box never goes left of the margin.
 */
export function moveBox(box: ZoomBox, key: BoxKey, margins: Margins, ruling?: number, inkRight?: number): ZoomBox {
  const quarter = box.width / 4;
  const { x, y } = box.origin;
  switch (key) {
    case 'left':
      return withOrigin(box, { x: Math.max(margins.left, x - quarter), y });
    case 'right':
      return withOrigin(box, { x: x + quarter, y });
    case 'up':
      return withOrigin(box, { x, y: y - lineStep(box, ruling) });
    case 'down':
      return withOrigin(box, { x, y: y + lineStep(box, ruling) });
    case 'home':
      return withOrigin(box, { x: margins.left, y });
    case 'end':
      return withOrigin(box, { x: Math.max(margins.left, inkRight ?? margins.left), y });
  }
}

/** The line number the box is on, counting from 1, for the announcement "Zoom writing box on, line 3." */
export function lineNumber(box: ZoomBox, firstLineTop: number, ruling?: number): number {
  return Math.max(1, Math.round((box.origin.y - firstLineTop) / lineStep(box, ruling)) + 1);
}

/** How far to scroll so the box is wholly in view, with some room around it. Zero when it already is. */
export function revealDelta(box: ZoomBox, view: Bounds, padding = 24): Vec {
  const b = boxBounds(box);
  const dx = b.minX - padding < view.minX ? b.minX - padding - view.minX : Math.max(0, b.maxX + padding - view.maxX);
  const dy = b.minY - padding < view.minY ? b.minY - padding - view.minY : Math.max(0, b.maxY + padding - view.maxY);
  return { x: dx, y: dy };
}
