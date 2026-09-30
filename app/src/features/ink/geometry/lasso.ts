// Lasso selection over the stroke index (design 9.3): a path becomes a polygon, candidates come from the spatial
// index, and a coarse mask answers most strokes without testing a point. The rest count their points inside.

import { boundsOf, strokeBounds } from './bounds';
import { classifyBox, EDGE, INSIDE, buildMask, stateAt } from './lassoMask';
import type { LassoMask } from './lassoMask';
import { distance, lerp, pointInPolygon } from './primitives';
import { simplify } from './simplify';
import { pagePoints } from './strokeIndex';
import type { StrokeIndex } from './strokeIndex';
import type { Stroke, Vec } from './types';

/** How much of a stroke must fall inside the lasso: a share of it, any part, or all of it. */
export type LassoMode = 'mostly' | 'any' | 'all';

export interface LassoOptions {
  readonly mode?: LassoMode;
  /** The share of a stroke that must be inside for `mostly`, 0 to 1. Defaults to 0.6. */
  readonly threshold?: number;
  /** One screen pixel in page units. The path is simplified to this tolerance, and mask cells are never smaller. */
  readonly pixel?: number;
  /** Strokes this returns true for are never selected. */
  readonly skip?: (stroke: Stroke) => boolean;
}

export const DEFAULT_LASSO_THRESHOLD = 0.6;
/** A stroke's points are checked at least this close together, in page units. */
const SAMPLE_STEP = 2;

/** Every sample along the stroke's centerline: its points, with extra ones so none are more than SAMPLE_STEP apart. */
function forEachSample(points: readonly Vec[], visit: (p: Vec) => boolean): void {
  if (!visit(points[0])) return;
  for (let i = 1; i < points.length; i++) {
    const pieces = Math.max(1, Math.ceil(distance(points[i - 1], points[i]) / SAMPLE_STEP));
    for (let k = 1; k <= pieces; k++) {
      if (!visit(k === pieces ? points[i] : lerp(points[i - 1], points[i], k / pieces))) return;
    }
  }
}

/** The share of a stroke's samples that fall inside the lasso. Stops early once `mode` is decided. */
function shareInside(mask: LassoMask, points: readonly Vec[], mode: LassoMode): number {
  let inside = 0;
  let total = 0;
  forEachSample(points, (p) => {
    const state = stateAt(mask, p);
    const isIn = state === INSIDE || (state === EDGE && pointInPolygon(p, mask.polygon));
    total++;
    if (isIn) inside++;
    return mode === 'any' ? !isIn : mode === 'all' ? isIn : true;
  });
  return total === 0 ? 0 : inside / total;
}

function selects(mask: LassoMask, stroke: Stroke, mode: LassoMode, threshold: number): boolean {
  const box = classifyBox(mask, strokeBounds(stroke));
  if (box === 'outside') return false;
  if (box === 'inside') return true;
  const share = shareInside(mask, pagePoints(stroke), mode);
  if (mode === 'any') return share > 0;
  return mode === 'all' ? share === 1 : share >= threshold;
}

/** The ids of the strokes a lasso path selects. The path closes itself from its last point back to its first. */
export function lassoSelect(index: StrokeIndex, path: readonly Vec[], options: LassoOptions = {}): string[] {
  const { mode = 'mostly', threshold = DEFAULT_LASSO_THRESHOLD, pixel = 1, skip } = options;
  const polygon = simplify(path, pixel);
  if (polygon.length < 3) return [];
  const mask = buildMask(polygon, { minCell: pixel });
  const selected: string[] = [];
  for (const stroke of index.query(boundsOf(polygon))) {
    if (!skip?.(stroke) && selects(mask, stroke, mode, threshold)) selected.push(stroke.id);
  }
  return selected;
}

/** A rectangular lasso, such as the marquee: four corners. */
export function rectanglePath(a: Vec, b: Vec): Vec[] {
  return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
}
