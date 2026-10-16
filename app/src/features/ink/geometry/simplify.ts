// Thinning and resampling of polylines: Ramer-Douglas-Peucker for the lasso path and shape corners, and even
// spacing for shape fitting.

import { distance, lerp, pointSegmentDistanceSq, polylineLength } from './primitives';
import type { Vec } from './types';

/**
 * Ramer-Douglas-Peucker: the fewest points that keep every dropped point within `tolerance` of the result. It keeps
 * the first and last points and works without recursion, so a stroke of 200,000 points is safe.
 */
export function simplify<T extends Vec>(points: readonly T[], tolerance: number): T[] {
  if (points.length < 3) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const limitSq = tolerance * tolerance;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let worst = -1;
    let worstSq = limitSq;
    for (let i = first + 1; i < last; i++) {
      const dSq = pointSegmentDistanceSq(points[i], points[first], points[last]);
      if (dSq > worstSq) {
        worst = i;
        worstSq = dSq;
      }
    }
    if (worst < 0) continue;
    keep[worst] = 1;
    stack.push([first, worst], [worst, last]);
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** `count` points spaced evenly along the path, with the two ends of the path among them. */
export function resample(points: readonly Vec[], count: number): Vec[] {
  const total = polylineLength(points);
  if (points.length < 2 || total === 0 || count < 2) return points.slice(0, 1);
  const step = total / (count - 1);
  const out: Vec[] = [points[0]];
  let carried = 0;
  for (let i = 1; i < points.length && out.length < count; i++) {
    const segment = distance(points[i - 1], points[i]);
    while (segment > 0 && carried + segment >= step * out.length - 1e-9 && out.length < count) {
      const t = (step * out.length - carried) / segment;
      out.push(lerp(points[i - 1], points[i], Math.min(1, Math.max(0, t))));
    }
    carried += segment;
  }
  while (out.length < count) out.push(points[points.length - 1]);
  return out;
}

/** Points along the path no farther apart than `step`, keeping every original point. */
export function densify(points: readonly Vec[], step: number): Vec[] {
  const out: Vec[] = points.length > 0 ? [points[0]] : [];
  for (let i = 1; i < points.length; i++) {
    const pieces = Math.ceil(distance(points[i - 1], points[i]) / step);
    for (let k = 1; k < pieces; k++) out.push(lerp(points[i - 1], points[i], k / pieces));
    out.push(points[i]);
  }
  return out;
}
