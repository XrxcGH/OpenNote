// Corners of a closed stroke and the polygon they make (design 11.2). The sharpest points come first, as in ShortStraw
// (Wolin, Eoff, and Hammond, 2008): at a corner the "straw", the chord between the points a few steps before and
// after, is short. From one of those, the corners are the ones whose polygon lies closest to the stroke (the optimal
// polygon of Perez and Vidal, 1994), so a short side, such as the foot of an L or the tip of a star, keeps its
// corners. Each side is then fitted with a line and the corners move to where neighboring lines meet.

import { distance } from '../primitives';
import type { Vec } from '../types';
import { fitLine } from './lines';

/** Points on each side of a point that the straw spans. */
const STRAW_WINDOW = 3;
/** No side is shorter than this share of the outline. */
const MIN_SIDE = 0.03;
/** The polygon is tried from this many of the sharpest points, and the closest one is kept. */
const ANCHORS = 3;
/** A side's line is fitted without this share of the side at each end, where the corner rounds off. */
const SIDE_TRIM = 0.15;
/** Adjacent sides closer than this to parallel (the sine of the angle between them) have no clear corner. */
const MIN_CORNER_SINE = 0.2;

export interface PolygonFit {
  readonly corners: readonly Vec[];
  /** The mean distance of the points from the polygon's outline, as a share of the square root of its area. */
  readonly error: number;
}

/** The squared distance from `p` to the segment from `a` to `b`. */
function segmentDistanceSq(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  const ex = a.x + dx * t - p.x;
  const ey = a.y + dy * t - p.y;
  return ex * ex + ey * ey;
}

/** Each outline's side costs, kept while the outline lives: every count of corners tried on it shares them. */
const sideCosts = new WeakMap<readonly Vec[], Float64Array>();

/**
 * How far the points of a closed outline lie from each side that could join two of them: at `a * (n + 1) + length`,
 * the total squared distance of the points after point `a` and before point `a + length` (going round) from the
 * side from one to the other.
 */
function sideCostsOf(points: readonly Vec[], minSide: number): Float64Array {
  const cached = sideCosts.get(points);
  if (cached) return cached;
  const n = points.length;
  const cost = new Float64Array(n * (n + 1));
  for (let a = 0; a < n; a++) {
    for (let length = minSide; length <= n; length++) {
      const end = points[(a + length) % n];
      let sum = 0;
      for (let k = 1; k < length; k++) sum += segmentDistanceSq(points[(a + k) % n], points[a], end);
      cost[a * (n + 1) + length] = sum;
    }
  }
  sideCosts.set(points, cost);
  return cost;
}

/**
 * The `count` corners, from `anchor` on, whose polygon lies closest to the outline: the least total squared distance
 * of the points from the sides, found by dynamic programming over where each side ends.
 */
function closestPolygon(points: readonly Vec[], anchor: number, count: number, minSide: number) {
  const n = points.length;
  const sides = sideCostsOf(points, minSide);
  const cost = (i: number, j: number) => sides[((anchor + i) % n) * (n + 1) + (j - i)];
  let best = new Float64Array(n + 1).fill(Infinity);
  best[0] = 0;
  const from: Int32Array[] = [];
  for (let side = 0; side < count; side++) {
    const next = new Float64Array(n + 1).fill(Infinity);
    const back = new Int32Array(n + 1).fill(-1);
    for (let j = minSide; j <= n; j++) {
      for (let i = 0; i <= j - minSide; i++) {
        const total = best[i] + cost(i, j);
        if (total < next[j]) {
          next[j] = total;
          back[j] = i;
        }
      }
    }
    from.push(back);
    best = next;
  }
  if (!Number.isFinite(best[n])) return null;
  const indices: number[] = [];
  for (let side = count - 1, j = n; side >= 0; side--) {
    j = from[side][j];
    indices.push((anchor + j) % n);
  }
  return { indices: indices.sort((p, q) => p - q), cost: best[n] };
}

/** Indices of the `count` corners of a closed outline, in path order, or null when the outline is too short for them. */
export function pickCorners(points: readonly Vec[], count: number): number[] | null {
  const n = points.length;
  const minSide = Math.max(2, Math.round(MIN_SIDE * n));
  if (count < 3 || n < count * minSide) return null;
  const straws = points.map((_, i) => distance(points[(i - STRAW_WINDOW + n) % n], points[(i + STRAW_WINDOW) % n]));
  const anchors = straws
    .map((straw, i) => ({ i, straw }))
    .filter(({ i, straw }) => [-2, -1, 1, 2].every((k) => straw <= straws[(i + k + n) % n]))
    .sort((a, b) => a.straw - b.straw)
    .slice(0, ANCHORS);
  let best: { indices: number[]; cost: number } | null = null;
  for (const { i } of anchors) {
    const found = closestPolygon(points, i, count, minSide);
    if (found && (!best || found.cost < best.cost)) best = found;
  }
  return best?.indices ?? null;
}

/** The points from corner `from` to corner `to` along a closed outline. The walk goes forward and wraps at the end. */
function sidePoints(points: readonly Vec[], from: number, to: number): Vec[] {
  const n = points.length;
  const side: Vec[] = [];
  for (let i = from; ; i = (i + 1) % n) {
    side.push(points[i]);
    if (i === to) return side;
  }
}

/** Where two lines meet, each given as a point and a direction, or null when they are nearly parallel. */
function meet(a: { p: Vec; d: Vec }, b: { p: Vec; d: Vec }): Vec | null {
  const cross = a.d.x * b.d.y - a.d.y * b.d.x;
  if (Math.abs(cross) < MIN_CORNER_SINE) return null;
  const t = ((b.p.x - a.p.x) * b.d.y - (b.p.y - a.p.y) * b.d.x) / cross;
  return { x: a.p.x + a.d.x * t, y: a.p.y + a.d.y * t };
}

/** Fits a line to the middle of each side, then finds the corners where neighboring lines meet. */
export function fitPolygon(points: readonly Vec[], cornerIndices: readonly number[]): PolygonFit | null {
  const lines: { p: Vec; d: Vec }[] = [];
  for (let k = 0; k < cornerIndices.length; k++) {
    const side = sidePoints(points, cornerIndices[k], cornerIndices[(k + 1) % cornerIndices.length]);
    const trim = Math.max(1, Math.floor(side.length * SIDE_TRIM));
    const fit = fitLine(side.slice(trim, side.length - trim));
    if (!fit || fit.length <= 0) return null;
    lines.push({
      p: fit.from,
      d: { x: (fit.to.x - fit.from.x) / fit.length, y: (fit.to.y - fit.from.y) / fit.length },
    });
  }
  const corners: Vec[] = [];
  for (let k = 0; k < lines.length; k++) {
    const corner = meet(lines[(k + lines.length - 1) % lines.length], lines[k]);
    if (!corner) return null;
    corners.push(corner);
  }
  const area = polygonArea(corners);
  if (area < 1e-6) return null;
  return { corners, error: outlineError(points, corners) / Math.sqrt(area) };
}

/** The area of a polygon by the shoelace formula, always positive. */
export function polygonArea(corners: readonly Vec[]): number {
  let twice = 0;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

/** The mean distance from each point to the nearest side of the polygon. */
function outlineError(points: readonly Vec[], corners: readonly Vec[]): number {
  let total = 0;
  for (const p of points) {
    let best = Infinity;
    for (let i = 0; i < corners.length; i++) {
      best = Math.min(best, distanceToSegment(p, corners[i], corners[(i + 1) % corners.length]));
    }
    total += best;
  }
  return total / points.length;
}

function distanceToSegment(p: Vec, a: Vec, b: Vec): number {
  const length = distance(a, b);
  if (length === 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (length * length)));
  return distance(p, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
}
