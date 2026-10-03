// Levels of detail and smoothing (architecture 6.3). Tiles drawn at a small scale do not need every point of a stroke.
// At 0.25 device pixels per page unit or more, a stroke is thinned with Ramer-Douglas-Peucker at a tolerance of
// 0.25 / scale. It keeps its first point, its last, and the points where pressure peaks or dips, so the width of the
// stroke survives. Below 0.25 a stroke draws as a plain polyline with no outline.

import { simplify } from './simplify';
import type { InkPoint, Vec } from './types';

/** Below this tile scale, in device pixels per page unit, strokes draw as uniform polylines. */
export const POLYLINE_BELOW_SCALE = 0.25;
/** The thinnest a polyline draws, in device pixels. */
export const MIN_POLYLINE_PX = 0.5;

export type DetailLevel = 'exact' | 'polyline';

export function detailLevel(scale: number): DetailLevel {
  return scale >= POLYLINE_BELOW_SCALE ? 'exact' : 'polyline';
}

/** The simplification tolerance in page units for a tile scale: a quarter of a device pixel. */
export function lodTolerance(scale: number): number {
  return 0.25 / scale;
}

/** The polyline width in device pixels for a stroke of the given width at a tile scale. */
export function polylineWidth(width: number, scale: number): number {
  return Math.max(width * scale, MIN_POLYLINE_PX);
}

/**
 * The indices of points where pressure turns: a local peak or dip that the pressure left by at least `swing`.
 * Strokes without pressure have none.
 */
export function pressureExtremes(points: readonly InkPoint[], swing = 0.1): number[] {
  const found: number[] = [];
  let direction = 0;
  let at = -1;
  for (let i = 0; i < points.length; i++) {
    const value = points[i].pressure;
    if (value === undefined) continue;
    if (at < 0) {
      at = i;
      continue;
    }
    const gap = value - points[at].pressure!;
    if (direction === 0) {
      if (Math.abs(gap) < swing) continue;
      direction = Math.sign(gap);
      at = i;
    } else if (gap * direction > 0) {
      at = i;
    } else if (Math.abs(gap) >= swing) {
      found.push(at);
      direction = -direction;
      at = i;
    }
  }
  return found;
}

/**
 * Thins a stroke's points. Every dropped point lies within `tolerance` of the result, except that the first point,
 * the last, and the pressure extremes are always kept.
 */
export function simplifyStroke<T extends InkPoint>(points: readonly T[], tolerance: number): T[] {
  if (points.length < 3) return [...points];
  const anchors = [...new Set([0, ...pressureExtremes(points), points.length - 1])].sort((a, b) => a - b);
  const out: T[] = [];
  for (let k = 0; k + 1 < anchors.length; k++) {
    const piece = simplify(points.slice(anchors[k], anchors[k + 1] + 1), tolerance);
    out.push(...piece.slice(0, -1));
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * Smooths a path by averaging each inner point with its neighbors, weights 1, 2, 1. The ends stay where they are, so
 * a stroke still starts and stops under the pen. Each pass shortens the path a little and never moves a point outside
 * the box of its neighbors. Other channels (pressure, time) are left alone.
 */
export function smoothPath<T extends Vec>(points: readonly T[], passes = 1): T[] {
  let current: T[] = [...points];
  for (let pass = 0; pass < passes && current.length > 2; pass++) {
    const source = current;
    current = source.map((p, i) => {
      if (i === 0 || i === source.length - 1) return p;
      const [a, c] = [source[i - 1], source[i + 1]];
      return { ...p, x: (a.x + 2 * p.x + c.x) / 4, y: (a.y + 2 * p.y + c.y) / 4 };
    });
  }
  return current;
}
