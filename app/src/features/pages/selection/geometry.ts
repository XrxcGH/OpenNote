// Plane geometry for lasso selection: a lasso is a closed polygon of page points. Everything here is pure arithmetic.

import type { Rect } from '../pagination/geometry';
import type { Point } from '../zoom/transform';

/** A closed polygon: the last point joins the first. */
export type Lasso = readonly Point[];

/** The box around some points, or null when there are none. */
export function boxOfPoints(points: readonly Point[]): Rect | null {
  if (points.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The smallest box that holds both, or the one that exists. */
export function unionBox(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export function growBox(box: Rect, by: number): Rect {
  return { x: box.x - by, y: box.y - by, w: box.w + 2 * by, h: box.h + 2 * by };
}

export function boxesTouch(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

/** True when the point lies inside the polygon (even-odd rule). */
export function inPolygon(p: Point, polygon: Lasso): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

const side = (a: Point, b: Point, c: Point): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** True when segment ab crosses or touches segment cd. */
export function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = side(c, d, a);
  const d2 = side(c, d, b);
  const d3 = side(a, b, c);
  const d4 = side(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const within = (p: Point, q: Point, r: Point) =>
    Math.min(p.x, q.x) <= r.x && r.x <= Math.max(p.x, q.x) && Math.min(p.y, q.y) <= r.y && r.y <= Math.max(p.y, q.y);
  return (
    (d1 === 0 && within(c, d, a)) ||
    (d2 === 0 && within(c, d, b)) ||
    (d3 === 0 && within(a, b, c)) ||
    (d4 === 0 && within(a, b, d))
  );
}

/** True when the path of points (not closed) touches the polygon: a point inside it, or a segment across its edge. */
export function pathTouches(path: readonly Point[], polygon: Lasso): boolean {
  if (polygon.length < 3 || path.length === 0) return false;
  if (path.some((p) => inPolygon(p, polygon))) return true;
  for (let i = 1; i < path.length; i += 1) {
    for (let j = 0, k = polygon.length - 1; j < polygon.length; k = j, j += 1) {
      if (segmentsCross(path[i - 1], path[i], polygon[k], polygon[j])) return true;
    }
  }
  return false;
}

export function corners(r: Rect): Point[] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
}

/** True when the rectangle and the polygon share any area or edge. */
export function rectTouchesPolygon(r: Rect, polygon: Lasso): boolean {
  if (polygon.length < 3) return false;
  const box = boxOfPoints(polygon)!;
  if (!boxesTouch(r, box)) return false;
  const rect = corners(r);
  if (rect.some((c) => inPolygon(c, polygon))) return true;
  if (polygon.some((p) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h)) return true;
  return pathTouches([...rect, rect[0]], polygon);
}
