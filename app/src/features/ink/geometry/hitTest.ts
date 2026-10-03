// Hit tests against the stroke index: a point for clicks and hover (design 9.5), and eraser capsules (design 9.2).

import { grow } from './bounds';
import { pointSegmentDistanceSq, segmentDistanceSq } from './primitives';
import { drawOrder, halfWidth, pagePoints } from './strokeIndex';
import type { StrokeIndex } from './strokeIndex';
import type { Bounds, Capsule, Stroke, Vec } from './types';

/** True when the stroke's ink comes within `radius` of the point. */
export function strokeNearPoint(stroke: Stroke, p: Vec, radius: number): boolean {
  const points = pagePoints(stroke);
  const reach = radius + halfWidth(stroke);
  const reachSq = reach * reach;
  if (points.length === 1) return pointSegmentDistanceSq(p, points[0], points[0]) <= reachSq;
  for (let i = 1; i < points.length; i++) {
    if (pointSegmentDistanceSq(p, points[i - 1], points[i]) <= reachSq) return true;
  }
  return false;
}

/** The topmost stroke whose ink comes within `radius` of the point, or null. */
export function hitPoint(index: StrokeIndex, p: Vec, radius: number): Stroke | null {
  let top: Stroke | null = null;
  for (const stroke of index.query(grow({ minX: p.x, minY: p.y, maxX: p.x, maxY: p.y }, radius))) {
    if (strokeNearPoint(stroke, p, radius) && (!top || drawOrder(stroke, top) > 0)) top = stroke;
  }
  return top;
}

export function capsuleBounds(c: Capsule): Bounds {
  return grow(
    {
      minX: Math.min(c.from.x, c.to.x),
      minY: Math.min(c.from.y, c.to.y),
      maxX: Math.max(c.from.x, c.to.x),
      maxY: Math.max(c.from.y, c.to.y),
    },
    c.radius,
  );
}

/** True when the stroke's ink touches the capsule: the centerline comes within the radius plus half the width. */
export function strokeTouchesCapsule(stroke: Stroke, c: Capsule): boolean {
  const points = pagePoints(stroke);
  const reach = c.radius + halfWidth(stroke);
  const reachSq = reach * reach;
  if (points.length === 1) return pointSegmentDistanceSq(points[0], c.from, c.to) <= reachSq;
  for (let i = 1; i < points.length; i++) {
    if (segmentDistanceSq(c.from, c.to, points[i - 1], points[i]) <= reachSq) return true;
  }
  return false;
}

/** The strokes touched by any of the capsules, each once, in no particular order. */
export function hitCapsules(index: StrokeIndex, capsules: readonly Capsule[]): Stroke[] {
  const hit = new Map<string, Stroke>();
  for (const capsule of capsules) {
    for (const stroke of index.query(capsuleBounds(capsule))) {
      if (!hit.has(stroke.id) && strokeTouchesCapsule(stroke, capsule)) hit.set(stroke.id, stroke);
    }
  }
  return [...hit.values()];
}
