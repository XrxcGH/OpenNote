// Lasso selection over the stroke index (design 9.3): a path becomes a polygon, candidates come from the spatial
// index, and a coarse mask answers most strokes without testing a point. The rest count their points inside.

import { boundsOf } from './bounds';
import { buildMask, classifyBox, insideMask } from './lassoMask';
import type { LassoMask } from './lassoMask';
import { simplify } from './simplify';
import { pagePoints } from './strokeIndex';
import type { StrokeIndex } from './strokeIndex';
import type { Bounds, Stroke, Vec } from './types';

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

/**
 * The share of a stroke's centerline samples that fall inside the lasso. Samples come about one per SAMPLE_STEP
 * along the stroke. Points closer than that to the last sample are skipped, and longer gaps get extra samples. It
 * stops early once `mode` is decided.
 */
function shareInside(mask: LassoMask, points: readonly Vec[], mode: LassoMode): number {
  let inside = insideMask(mask, points[0].x, points[0].y) ? 1 : 0;
  let total = 1;
  let lastX = points[0].x;
  let lastY = points[0].y;
  for (let i = 1; i < points.length; i++) {
    const { x, y } = points[i];
    const gapSq = (x - lastX) * (x - lastX) + (y - lastY) * (y - lastY);
    if (gapSq < SAMPLE_STEP * SAMPLE_STEP && i < points.length - 1) continue;
    const pieces = Math.max(1, Math.ceil(Math.sqrt(gapSq) / SAMPLE_STEP));
    for (let k = 1; k <= pieces; k++) {
      const isIn = insideMask(mask, lastX + ((x - lastX) * k) / pieces, lastY + ((y - lastY) * k) / pieces);
      total++;
      if (isIn) inside++;
      if (mode === 'any' ? isIn : mode === 'all' && !isIn) return inside / total;
    }
    lastX = x;
    lastY = y;
  }
  return inside / total;
}

function selects(mask: LassoMask, stroke: Stroke, bounds: Bounds, mode: LassoMode, threshold: number): boolean {
  const box = classifyBox(mask, bounds);
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
  for (const { value: stroke, bounds } of index.find(boundsOf(polygon))) {
    if (!skip?.(stroke) && selects(mask, stroke, bounds, mode, threshold)) selected.push(stroke.id);
  }
  return selected;
}

/** A rectangular lasso, such as the marquee: four corners. */
export function rectanglePath(a: Vec, b: Vec): Vec[] {
  return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
}
