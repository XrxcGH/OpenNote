// Scribble to erase (architecture 12.4). At pen-up, a path that goes back and forth over ink many times erases the
// strokes under it instead of adding a stroke. The detector looks at the shape of one path. Whether it covers ink is a
// second step, `scribbleTargets`, and a scribble that covers none stays as ink, since it may be shading.

import { boundsOf, strokeBounds } from '../../geometry/bounds';
import { lassoSelect } from '../../geometry/lasso';
import { distance, polylineLength } from '../../geometry/primitives';
import type { StrokeIndex } from '../../geometry/strokeIndex';
import type { InkPoint, InkTool, Stroke, Vec } from '../../geometry/types';

export interface ScribbleOptions {
  /** The path must be at least this many times the diagonal of its box. */
  readonly minPathRatio: number;
  /** The path must turn back at least this many times along its main axis. */
  readonly minReversals: number;
  /** The path must take less time than this, when it has times. */
  readonly maxDurationMs: number;
  /** A turn counts only when the path went back at least this share of its extent along the axis. */
  readonly minSwing: number;
  /** A path with a smaller extent than this, in page units, is a mark and not a scribble. */
  readonly minExtent: number;
  /**
   * The stroke's tool. Only a pen or a pencil scribbles: a highlighter, a marker, or a brush going back and forth
   * over words is coloring them in.
   */
  readonly tool?: InkTool;
}

const SCRIBBLE_TOOLS: ReadonlySet<InkTool> = new Set(['pen', 'pencil']);

export const DEFAULT_SCRIBBLE: ScribbleOptions = {
  minPathRatio: 3,
  // Six turns: a retraced capital M or a run of tally marks turns four times.
  minReversals: 6,
  maxDurationMs: 2000,
  minSwing: 0.25,
  minExtent: 12,
};

export interface ScribbleMatch {
  /** The convex hull of the path, which decides what it covers. */
  readonly hull: readonly Vec[];
  readonly reversals: number;
  readonly pathRatio: number;
}

/** The convex hull by Andrew's monotone chain, counterclockwise on screen axes. */
export function convexHull(points: readonly Vec[]): Vec[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) return sorted;
  const cross = (o: Vec, a: Vec, b: Vec) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (list: readonly Vec[]) => {
    const chain: Vec[] = [];
    for (const p of list) {
      while (chain.length >= 2 && cross(chain[chain.length - 2], chain[chain.length - 1], p) <= 0) chain.pop();
      chain.push(p);
    }
    chain.pop();
    return chain;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

/** The path's positions along its main axis, by the direction of greatest spread, centered on the mean. */
function mainAxisPositions(points: readonly Vec[]): number[] {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const [ax, ay] = [Math.cos(angle), Math.sin(angle)];
  return points.map((p) => (p.x - mx) * ax + (p.y - my) * ay);
}

/** Counts the turning points of a series, where a turn needs a swing of at least `swing` back from the extreme. */
export function countReversals(series: readonly number[], swing: number): number {
  let direction = 0;
  let extreme = series[0] ?? 0;
  let reversals = 0;
  for (const value of series) {
    if (direction === 0) {
      if (Math.abs(value - extreme) >= swing) {
        direction = value > extreme ? 1 : -1;
        extreme = value;
      }
    } else if ((value - extreme) * direction > 0) {
      extreme = value;
    } else if (Math.abs(value - extreme) >= swing) {
      reversals++;
      direction = -direction;
      extreme = value;
    }
  }
  return reversals;
}

function elapsed(points: readonly InkPoint[]): number | null {
  const first = points[0]?.time;
  const last = points[points.length - 1]?.time;
  return first === undefined || last === undefined ? null : last - first;
}

/** Looks at one finished path and says whether it is a scribble. */
export function detectScribble(
  points: readonly InkPoint[],
  options: Partial<ScribbleOptions> = {},
): ScribbleMatch | null {
  const o = { ...DEFAULT_SCRIBBLE, ...options };
  if (!SCRIBBLE_TOOLS.has(o.tool ?? 'pen')) return null;
  if (points.length < 2 * o.minReversals) return null;
  const duration = elapsed(points);
  if (duration !== null && duration >= o.maxDurationMs) return null;
  const box = boundsOf(points);
  const diagonal = distance({ x: box.minX, y: box.minY }, { x: box.maxX, y: box.maxY });
  if (diagonal < o.minExtent) return null;
  const pathRatio = polylineLength(points) / diagonal;
  if (pathRatio < o.minPathRatio) return null;
  const axis = mainAxisPositions(points);
  const extent = Math.max(...axis) - Math.min(...axis);
  const reversals = countReversals(axis, extent * o.minSwing);
  if (reversals < o.minReversals) return null;
  return { hull: convexHull(points), reversals, pathRatio };
}

export interface ScribbleTargetOptions {
  /** The share of a stroke's length that must lie under the scribble. Defaults to 0.3. */
  readonly share?: number;
  readonly skip?: (stroke: Stroke) => boolean;
  /** The ink erased must reach across this share of the scribble's longer side. Defaults to 0.25. */
  readonly cover?: number;
}

export const SCRIBBLE_SHARE = 0.3;
export const SCRIBBLE_COVER = 0.25;

/**
 * The strokes a scribble erases: those with at least 30 percent of their length inside its hull, when together they
 * reach across a quarter of the scribble.
 */
export function scribbleTargets(
  index: StrokeIndex,
  match: ScribbleMatch,
  options: ScribbleTargetOptions = {},
): string[] {
  const targets = lassoSelect(index, match.hull, {
    mode: 'mostly',
    threshold: options.share ?? SCRIBBLE_SHARE,
    skip: options.skip,
  });
  // A scribble over an i-dot or a short descender is a letter written there, so a few tiny marks are never erased.
  const hull = boundsOf(match.hull);
  const side = Math.max(hull.maxX - hull.minX, hull.maxY - hull.minY);
  let reach = 0;
  for (const id of targets) {
    const box = strokeBounds(index.get(id)!);
    reach += Math.max(box.maxX - box.minX, box.maxY - box.minY);
  }
  return reach >= side * (options.cover ?? SCRIBBLE_COVER) ? targets : [];
}
