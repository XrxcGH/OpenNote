// Small pieces of 2D geometry that hit testing, erasing, and shape fitting share.

import type { Capsule, Vec } from './types';

/** A closed range of a segment's parameter, where 0 is the segment's start and 1 is its end. */
export type Interval = readonly [number, number];

export function distance(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function lerp(a: Vec, b: Vec, t: number): Vec {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function polylineLength(points: readonly Vec[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
  return total;
}

/** The squared distance from a point to a segment. */
export function pointSegmentDistanceSq(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  const ex = a.x + t * dx - p.x;
  const ey = a.y + t * dy - p.y;
  return ex * ex + ey * ey;
}

/** The sign of the turn from a to b to c: positive when it turns clockwise on screen, where y points down. */
function turn(a: Vec, b: Vec, c: Vec): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** True when two segments cross or touch. */
export function segmentsIntersect(a1: Vec, a2: Vec, b1: Vec, b2: Vec): boolean {
  const d1 = turn(b1, b2, a1);
  const d2 = turn(b1, b2, a2);
  const d3 = turn(a1, a2, b1);
  const d4 = turn(a1, a2, b2);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return d1 === 0 || d2 === 0 || d3 === 0 || d4 === 0 ? touching(a1, a2, b1, b2) : false;
}

/** The collinear and touching cases of segmentsIntersect, where an end lies exactly on the other segment. */
function touching(a1: Vec, a2: Vec, b1: Vec, b2: Vec): boolean {
  return (
    pointSegmentDistanceSq(a1, b1, b2) === 0 ||
    pointSegmentDistanceSq(a2, b1, b2) === 0 ||
    pointSegmentDistanceSq(b1, a1, a2) === 0 ||
    pointSegmentDistanceSq(b2, a1, a2) === 0
  );
}

/** The squared distance between two segments. */
export function segmentDistanceSq(a1: Vec, a2: Vec, b1: Vec, b2: Vec): number {
  if (segmentsIntersect(a1, a2, b1, b2)) return 0;
  return Math.min(
    pointSegmentDistanceSq(a1, b1, b2),
    pointSegmentDistanceSq(a2, b1, b2),
    pointSegmentDistanceSq(b1, a1, a2),
    pointSegmentDistanceSq(b2, a1, a2),
  );
}

/** Narrows `range` so that `lo <= v0 + t * dv <= hi` holds for every t in it. Returns false when nothing is left. */
function clipRange(range: [number, number], v0: number, dv: number, lo: number, hi: number): boolean {
  if (Math.abs(dv) < 1e-12) return v0 >= lo && v0 <= hi;
  const t1 = (lo - v0) / dv;
  const t2 = (hi - v0) / dv;
  range[0] = Math.max(range[0], Math.min(t1, t2));
  range[1] = Math.min(range[1], Math.max(t1, t2));
  return range[0] <= range[1];
}

function segmentCircleInterval(p0: Vec, p1: Vec, center: Vec, radius: number): Interval | null {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const fx = p0.x - center.x;
  const fy = p0.y - center.y;
  const a = dx * dx + dy * dy;
  if (a === 0) return fx * fx + fy * fy <= radius * radius ? [0, 1] : null;
  const b = 2 * (fx * dx + fy * dy);
  const disc = b * b - 4 * a * (fx * fx + fy * fy - radius * radius);
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const t0 = Math.max(0, (-b - root) / (2 * a));
  const t1 = Math.min(1, (-b + root) / (2 * a));
  return t0 <= t1 ? [t0, t1] : null;
}

function segmentBodyInterval(p0: Vec, p1: Vec, cap: Capsule): Interval | null {
  const length = distance(cap.from, cap.to);
  const ux = (cap.to.x - cap.from.x) / length;
  const uy = (cap.to.y - cap.from.y) / length;
  const x0 = p0.x - cap.from.x;
  const y0 = p0.y - cap.from.y;
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const range: [number, number] = [0, 1];
  const along = clipRange(range, x0 * ux + y0 * uy, dx * ux + dy * uy, 0, length);
  const across = clipRange(range, -x0 * uy + y0 * ux, -dx * uy + dy * ux, -cap.radius, cap.radius);
  return along && across ? range : null;
}

/**
 * The part of segment p0 to p1 that lies inside a capsule, as one parameter interval, or null when it misses.
 * A capsule is convex, so the part is always one piece: the union of the circle ends and the rectangle between them.
 */
export function segmentCapsuleInterval(p0: Vec, p1: Vec, cap: Capsule): Interval | null {
  const parts = [
    segmentCircleInterval(p0, p1, cap.from, cap.radius),
    segmentCircleInterval(p0, p1, cap.to, cap.radius),
  ];
  if (distance(cap.from, cap.to) > 1e-9) parts.push(segmentBodyInterval(p0, p1, cap));
  let start = Infinity;
  let end = -Infinity;
  for (const part of parts) {
    if (!part) continue;
    start = Math.min(start, part[0]);
    end = Math.max(end, part[1]);
  }
  return start <= end ? [start, end] : null;
}

/** True when the point lies inside the polygon by the nonzero winding rule, which forgives self-crossing loops. */
export function pointInPolygon(p: Vec, polygon: readonly Vec[]): boolean {
  let winding = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j];
    const b = polygon[i];
    if (a.y <= p.y) {
      if (b.y > p.y && turn(a, b, p) > 0) winding++;
    } else if (b.y <= p.y && turn(a, b, p) < 0) {
      winding--;
    }
  }
  return winding !== 0;
}
