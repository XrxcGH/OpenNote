// Moving, scaling, and rotating strokes. A stroke's raw points never change: each edit composes a matrix onto its
// transform (design 8.5), and width follows the matrix by the square root of its determinant.

import { boundsOf, union } from './bounds';
import { compose, IDENTITY, rotation, scaling, translation, widthScale } from './matrix';
import { pagePoints } from './strokeIndex';
import type { Bounds, Matrix, Stroke, Vec } from './types';

/** A stroke with `matrix` applied after its current transform. */
export function transformStroke<S extends Stroke>(stroke: S, matrix: Matrix): S {
  return { ...stroke, transform: compose(matrix, stroke.transform ?? IDENTITY) };
}

export function transformStrokes<S extends Stroke>(strokes: readonly S[], matrix: Matrix): S[] {
  return strokes.map((stroke) => transformStroke(stroke, matrix));
}

export function moveStrokes<S extends Stroke>(strokes: readonly S[], dx: number, dy: number): S[] {
  return transformStrokes(strokes, translation(dx, dy));
}

/** Scales about a fixed point, such as the corner opposite the handle being dragged. */
export function scaleStrokes<S extends Stroke>(strokes: readonly S[], sx: number, sy: number, about: Vec): S[] {
  return transformStrokes(strokes, scaling(sx, sy, about));
}

export function rotateStrokes<S extends Stroke>(strokes: readonly S[], radians: number, about: Vec): S[] {
  return transformStrokes(strokes, rotation(radians, about));
}

/** The raw points moved through the stroke's transform, which is then dropped. Shape handle edits store this form. */
export function bakeTransform<S extends Stroke>(stroke: S): S {
  if (!stroke.transform) return stroke;
  const baked = pagePoints(stroke).map((p, i) => ({ ...stroke.points[i], x: p.x, y: p.y }));
  const { transform: _dropped, ...rest } = stroke;
  return { ...rest, width: stroke.width * widthScale(stroke.transform), points: baked } as unknown as S;
}

/** The box around the centerlines of the strokes, in page space. It is what selection handles hug. */
export function selectionBounds(strokes: readonly Stroke[]): Bounds | null {
  let box: Bounds | null = null;
  for (const stroke of strokes) {
    const b = boundsOf(pagePoints(stroke));
    box = box ? union(box, b) : b;
  }
  return box;
}

/**
 * The matrix that carries a box onto another, for a resize or move of a whole selection. Returns null when the
 * source box has no area.
 */
export function boxToBox(from: Bounds, to: Bounds): Matrix | null {
  const w = from.maxX - from.minX;
  const h = from.maxY - from.minY;
  // A target with no area would give a matrix with no area: strokes that draw with width 0 and widths that divide by it.
  if (w <= 0 || h <= 0 || !(to.maxX - to.minX > 0) || !(to.maxY - to.minY > 0)) return null;
  const scale = scaling((to.maxX - to.minX) / w, (to.maxY - to.minY) / h, { x: from.minX, y: from.minY });
  return compose(translation(to.minX - from.minX, to.minY - from.minY), scale);
}
