// Circle and tap (architecture 12.4). A closed loop drawn around content, followed within a second by a quick pen tap
// inside it, selects the content as the lasso does. The loop is not added as ink. The page view holds a loop that
// encloses content for up to a second, with no progress record, and asks `matchCircleTap` when the pen touches again.

import { boundsOf } from '../../geometry/bounds';
import { lassoSelect } from '../../geometry/lasso';
import { distance, pointInPolygon, pointSegmentDistanceSq, polylineLength } from '../../geometry/primitives';
import { simplify } from '../../geometry/simplify';
import type { StrokeIndex } from '../../geometry/strokeIndex';
import type { Bounds, InkPoint, Stroke, Vec } from '../../geometry/types';

export interface LoopOptions {
  /** The shorter side of the loop's box must be at least this long, in page units. */
  readonly minSize: number;
  /** The gap between the ends may be at most this share of the box's longer side. */
  readonly maxGap: number;
  /** The path must turn at least this much in one direction, in radians. */
  readonly minTurn: number;
  /** The loop's area must be at least this share of its box, which rules out flat zigzags. */
  readonly minFill: number;
  /** The share of all turning that goes the main way, which rules out figure eights. */
  readonly minConsistency: number;
}

export const DEFAULT_LOOP: LoopOptions = {
  minSize: 24,
  maxGap: 0.3,
  minTurn: 1.5 * Math.PI,
  minFill: 0.25,
  minConsistency: 0.85,
};

export interface LoopMatch {
  /** The loop as a simplified polygon. */
  readonly polygon: readonly Vec[];
  readonly box: Bounds;
  /** When the pen lifted, in the path's own time, or undefined for a path without times. */
  readonly endTime: number | undefined;
}

function shoelaceArea(polygon: readonly Vec[]): number {
  let twice = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [a, b] = [polygon[i], polygon[(i + 1) % polygon.length]];
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

/** The signed turning at each inner vertex of an open path, in radians. */
function turningAngles(path: readonly Vec[]): number[] {
  const angles: number[] = [];
  for (let i = 1; i + 1 < path.length; i++) {
    const [a, b, c] = [path[i - 1], path[i], path[i + 1]];
    let turn = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x);
    while (turn > Math.PI) turn -= 2 * Math.PI;
    while (turn < -Math.PI) turn += 2 * Math.PI;
    angles.push(turn);
  }
  return angles;
}

/** The closest the path comes to a point within its first or last quarter by length, as the path's ends overlap. */
function reach(path: readonly Vec[], from: Vec, fromStart: boolean): number {
  const total = polylineLength(path);
  let along = 0;
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const length = distance(path[i - 1], path[i]);
    const inQuarter = fromStart ? along <= total / 4 : along + length >= (total * 3) / 4;
    if (inQuarter) best = Math.min(best, Math.sqrt(pointSegmentDistanceSq(from, path[i - 1], path[i])));
    along += length;
  }
  return best;
}

/** How far the loop is from closing: the ends may meet, or one end may run over the other's side of the path. */
function closingGap(path: readonly Vec[]): number {
  const [first, last] = [path[0], path[path.length - 1]];
  return Math.min(distance(first, last), reach(path, last, true), reach(path, first, false));
}

/** Looks at one finished path and says whether it is a closed loop. */
export function detectLoop(points: readonly InkPoint[], options: Partial<LoopOptions> = {}): LoopMatch | null {
  const o = { ...DEFAULT_LOOP, ...options };
  if (points.length < 8) return null;
  const box = boundsOf(points);
  const [w, h] = [box.maxX - box.minX, box.maxY - box.minY];
  if (Math.min(w, h) < o.minSize) return null;
  if (closingGap(points) > o.maxGap * Math.max(w, h)) return null;
  const polygon = simplify(points, Math.max(w, h) / 80);
  if (polygon.length < 4 || shoelaceArea(polygon) < o.minFill * w * h) return null;
  const turns = turningAngles(polygon);
  const net = turns.reduce((s, t) => s + t, 0);
  const total = turns.reduce((s, t) => s + Math.abs(t), 0);
  if (Math.abs(net) < o.minTurn || Math.abs(net) / total < o.minConsistency) return null;
  return { polygon, box, endTime: points[points.length - 1].time };
}

/** The strokes a loop encloses, by the lasso's "mostly inside" rule. Empty means the loop stays as ink. */
export function loopContent(
  index: StrokeIndex,
  loop: LoopMatch,
  options: { skip?: (stroke: Stroke) => boolean } = {},
): string[] {
  return lassoSelect(index, loop.polygon, { mode: 'mostly', skip: options.skip });
}

export interface Tap {
  /** In page units. */
  readonly x: number;
  readonly y: number;
  readonly downTime: number;
  readonly upTime: number;
  /** How far the pen moved while down, in screen pixels. */
  readonly travelPx: number;
}

export interface CircleTapOptions {
  readonly maxTapMs: number;
  readonly maxTravelPx: number;
  /** How long after the loop the tap may come. */
  readonly windowMs: number;
}

export const DEFAULT_CIRCLE_TAP: CircleTapOptions = { maxTapMs: 200, maxTravelPx: 4, windowMs: 1000 };

/**
 * True when a tap completes a circle and tap. The tap must be quick, still, inside the loop, and soon after it.
 * `loopEnd` is when the loop's pen lifted, on the same clock as the tap.
 */
export function matchCircleTap(
  loop: LoopMatch,
  loopEnd: number,
  tap: Tap,
  options: Partial<CircleTapOptions> = {},
): boolean {
  const o = { ...DEFAULT_CIRCLE_TAP, ...options };
  const sinceLoop = tap.downTime - loopEnd;
  if (sinceLoop < 0 || sinceLoop > o.windowMs) return false;
  if (tap.upTime - tap.downTime >= o.maxTapMs || tap.travelPx >= o.maxTravelPx) return false;
  return pointInPolygon(tap, loop.polygon);
}
