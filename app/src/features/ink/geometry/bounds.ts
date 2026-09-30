// Boxes in page units: the building block of the spatial index and of every hit test.

import { applyToPoint, widthScale } from './matrix';
import type { Bounds, Matrix, Stroke, Vec } from './types';

export function boundsOf(points: readonly Vec[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export function grow(b: Bounds, by: number): Bounds {
  return { minX: b.minX - by, minY: b.minY - by, maxX: b.maxX + by, maxY: b.maxY + by };
}

export function union(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/** True when the boxes share any area or edge. */
export function intersects(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

export function containsBounds(outer: Bounds, inner: Bounds): boolean {
  return outer.minX <= inner.minX && outer.minY <= inner.minY && outer.maxX >= inner.maxX && outer.maxY >= inner.maxY;
}

export function containsPoint(b: Bounds, p: Vec): boolean {
  return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
}

/** The box of a box's four corners after a transform. */
export function transformBounds(b: Bounds, m: Matrix): Bounds {
  return boundsOf([
    applyToPoint(m, { x: b.minX, y: b.minY }),
    applyToPoint(m, { x: b.maxX, y: b.minY }),
    applyToPoint(m, { x: b.minX, y: b.maxY }),
    applyToPoint(m, { x: b.maxX, y: b.maxY }),
  ]);
}

/** The page-space box of a stroke: its transformed points grown by half its transformed width. */
export function strokeBounds(stroke: Stroke): Bounds {
  const raw = boundsOf(stroke.points);
  if (!stroke.transform) return grow(raw, stroke.width / 2);
  return grow(transformBounds(raw, stroke.transform), (stroke.width * widthScale(stroke.transform)) / 2);
}
