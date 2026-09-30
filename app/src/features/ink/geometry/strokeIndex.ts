// The strokes of one page with their spatial index: the table every hit test, eraser, and lasso reads (design 9.1).

import { strokeBounds } from './bounds';
import { applyToPoints, widthScale } from './matrix';
import { createSpatialIndex } from './spatialIndex';
import type { Bounds, Stroke, Vec } from './types';

export interface StrokeIndex {
  readonly size: number;
  get(id: string): Stroke | undefined;
  has(id: string): boolean;
  /** Adds a stroke, or replaces the one with the same id. */
  put(stroke: Stroke): void;
  remove(id: string): boolean;
  all(): IterableIterator<Stroke>;
  /** The strokes whose boxes meet the query box. Their ink may still miss it. */
  query(bounds: Bounds): Stroke[];
}

// Strokes never change once finished, so their page-space points are computed once.
const pageCache = new WeakMap<Stroke, readonly Vec[]>();

/** A stroke's points in page space: the raw points through its transform. Cached per stroke. */
export function pagePoints(stroke: Stroke): readonly Vec[] {
  if (!stroke.transform) return stroke.points;
  let points = pageCache.get(stroke);
  if (!points) {
    points = applyToPoints(stroke.transform, stroke.points);
    pageCache.set(stroke, points);
  }
  return points;
}

/** Half a stroke's drawn width in page space. */
export function halfWidth(stroke: Stroke): number {
  return (stroke.width * (stroke.transform ? widthScale(stroke.transform) : 1)) / 2;
}

export function createStrokeIndex(strokes: Iterable<Stroke> = [], cellSize?: number): StrokeIndex {
  const table = new Map<string, Stroke>();
  const spatial = createSpatialIndex(cellSize);
  const index: StrokeIndex = {
    get size() {
      return table.size;
    },
    get: (id) => table.get(id),
    has: (id) => table.has(id),
    put(stroke) {
      table.set(stroke.id, stroke);
      spatial.update(stroke.id, strokeBounds(stroke));
    },
    remove(id) {
      spatial.remove(id);
      return table.delete(id);
    },
    all: () => table.values(),
    query: (bounds) => spatial.search(bounds).map((id) => table.get(id)!),
  };
  for (const stroke of strokes) index.put(stroke);
  return index;
}

/**
 * The drawing order within a block: start time, then id, with highlighters below everything else (spec 8.2).
 * Negative when `a` is drawn below `b`.
 */
export function drawOrder(a: Stroke, b: Stroke): number {
  const aUnder = a.tool === 'highlighter' ? 0 : 1;
  const bUnder = b.tool === 'highlighter' ? 0 : 1;
  if (aUnder !== bUnder) return aUnder - bUnder;
  if (a.startTime !== b.startTime) return a.startTime - b.startTime;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
