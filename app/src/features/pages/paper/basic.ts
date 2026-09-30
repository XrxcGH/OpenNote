// The repeating patterns: ruled lines, grids, dot grids, isometric grids, and music staves. Each one fills a box and
// is anchored to an origin, so paginated sheets and the infinite canvas draw the same lines.

import { EPS, type Rect } from '../pagination/geometry';
import { MAX_TICKS, ticks, type Canvas } from './canvas';

export interface Point {
  readonly x: number;
  readonly y: number;
}

const ROOT3 = Math.sqrt(3);

/** Horizontal lines across the box at oy + k × step. */
export function ruled(c: Canvas, box: Rect, oy: number, step: number): void {
  for (const y of ticks(oy, step, box.y, box.y + box.h)) c.line(box.x, y, box.x + box.w, y);
}

/** Squares of side `step` from the origin, as lines across the box. */
export function grid(c: Canvas, box: Rect, origin: Point, step: number): void {
  for (const x of ticks(origin.x, step, box.x, box.x + box.w)) c.line(x, box.y, x, box.y + box.h);
  ruled(c, box, origin.y, step);
}

/** A dot at each crossing of the grid. */
export function dots(c: Canvas, box: Rect, origin: Point, step: number): void {
  const xs = ticks(origin.x, step, box.x, box.x + box.w);
  const ys = ticks(origin.y, step, box.y, box.y + box.h);
  for (const y of ys) for (const x of xs) c.dot(x, y);
}

type Segment = readonly [number, number, number, number];

/** The part of a segment inside the box (Liang and Barsky), or null when none of it is. */
function clip(x1: number, y1: number, x2: number, y2: number, box: Rect): Segment | null {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const edges: readonly (readonly [number, number])[] = [
    [-dx, x1 - box.x],
    [dx, box.x + box.w - x1],
    [-dy, y1 - box.y],
    [dy, box.y + box.h - y1],
  ];
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
  }
  if (t1 - t0 < EPS / Math.hypot(dx, dy)) return null;
  return [x1 + t0 * dx, y1 + t0 * dy, x1 + t1 * dx, y1 + t1 * dy];
}

/**
 * Equilateral triangles with sides of `step`: one family of lines is vertical and the other two lean 30 degrees off
 * horizontal. The three families meet at the origin and at every lattice point.
 */
export function isometric(c: Canvas, box: Rect, origin: Point, step: number): void {
  const right = box.x + box.w;
  const bottom = box.y + box.h;
  for (const x of ticks(origin.x, (step * ROOT3) / 2, box.x, right)) c.line(x, box.y, x, bottom);
  const rise = (x: number) => (x - origin.x) / ROOT3;
  const down = ticks(origin.y, step, box.y - rise(right), bottom - rise(box.x));
  const up = ticks(origin.y, step, box.y + rise(box.x), bottom + rise(right));
  for (const y of down) {
    const s = clip(box.x, y + rise(box.x), right, y + rise(right), box);
    if (s) c.line(...s);
  }
  for (const y of up) {
    const s = clip(box.x, y - rise(box.x), right, y - rise(right), box);
    if (s) c.line(...s);
  }
}

/** Five-line staves, each 4 × step tall with 6 × step of space between one staff and the next. */
export function staves(c: Canvas, box: Rect, step: number): void {
  const pitch = 10 * step;
  let count = 0;
  for (let top = box.y; top + 4 * step <= box.y + box.h + EPS && count < MAX_TICKS; top += pitch) {
    for (let i = 0; i < 5; i += 1) c.line(box.x, top + i * step, box.x + box.w, top + i * step);
    count += 5;
  }
}
