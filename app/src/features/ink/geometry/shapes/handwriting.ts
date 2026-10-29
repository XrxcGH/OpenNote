// Writing that ink-to-shape leaves as ink (Beta 6 bug 11). A round o, O, or 0 is an ellipse and an l is a line, so no
// recognizer can tell them from shapes by their outline alone. With ink-to-shape on, a lifted stroke stays ink when
// either of these holds.
// - It is small and quick. Its box's diagonal is under 40 screen pixels and the pen drew it in under 250 ms, as a
//   letter is written at note size.
// - It sits in a line of writing. Freehand ink about as tall as it lies beside it, level with it.
// A pen held still at the end of a stroke asks for a shape, so hold-to-shape is never guarded.

import { boundsOf } from '../bounds';
import type { Bounds, InkPoint } from '../types';

/** A stroke whose box's diagonal is under this many screen pixels is note-sized... */
const SMALL_PX = 40;
/** ...and is written, not drawn, when the pen took under this long. */
const QUICK_MS = 250;
/** Ink this many of the stroke's heights to its left or right is beside it. */
const BESIDE = 1.5;
/** Ink beside it is in the same line when its height is within this factor of the stroke's... */
const HEIGHT_FACTOR = 2;
/** ...and the two share this share of the lower one's height. */
const LEVEL_SHARE = 0.5;

const heightOf = (box: Bounds): number => box.maxY - box.minY;

/** Whether a stroke is note-sized at `zoom` (screen pixels per page unit) and was written quickly. */
export function smallAndQuick(points: readonly InkPoint[], zoom: number): boolean {
  if (points.length < 2) return false;
  const box = boundsOf(points);
  const start = points[0].time;
  const end = points[points.length - 1].time;
  if (start === undefined || end === undefined) return false;
  return Math.hypot(box.maxX - box.minX, box.maxY - box.minY) * zoom < SMALL_PX && end - start < QUICK_MS;
}

/** The box to look for writing in beside a stroke whose box is `box`. */
export function besideBox(box: Bounds): Bounds {
  const reach = BESIDE * heightOf(box);
  return { minX: box.minX - reach, minY: box.minY, maxX: box.maxX + reach, maxY: box.maxY };
}

/** Whether freehand ink with one of the boxes `writing` sits level with the stroke's box, about as tall, beside it. */
export function inLineOfWriting(box: Bounds, writing: readonly Bounds[]): boolean {
  const height = heightOf(box);
  if (!(height > 0)) return false;
  const reach = besideBox(box);
  return writing.some((other) => {
    const tall = heightOf(other);
    if (!(tall > 0) || tall > HEIGHT_FACTOR * height || height > HEIGHT_FACTOR * tall) return false;
    if (other.maxX < reach.minX || other.minX > reach.maxX) return false;
    const shared = Math.min(box.maxY, other.maxY) - Math.max(box.minY, other.minY);
    return shared >= LEVEL_SHARE * Math.min(height, tall);
  });
}
