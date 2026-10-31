// Handwritten working split into rows, one row per line of math, for Check my work. Pure, so it is tested alone.
import type { ShownStroke } from '../seams/inkStrokes';

/** In page units. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The most handwriting rows one check reads. */
const MAX_ROWS = 60;

/** The box around a stroke's points, in one pass: a long scribble has too many points to spread into Math.min. */
const strokeBox = (stroke: ShownStroke): Box => {
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const { x, y } of stroke.points) {
    if (x < box.x0) box.x0 = x;
    if (x > box.x1) box.x1 = x;
    if (y < box.y0) box.y0 = y;
    if (y > box.y1) box.y1 = y;
  }
  return box;
};

/** The middle value, or the lower of the two middle ones: a tall bracket among small letters does not move it. */
const median = (values: readonly number[]): number => [...values].sort((a, b) => a - b)[(values.length - 1) >> 1];

interface Row {
  strokes: ShownStroke[];
  box: Box;
  middles: number[];
  heights: number[];
}

/**
 * Strokes in rows: a stroke joins the nearest row whose middle line its own middle is within three quarters of the
 * row's usual stroke height of (or of its own height, for a small mark starting a row). The usual height is the
 * median, so a tall bracket or fraction bar does not stretch a row over the rows beside it.
 */
export function rowsOf(strokes: readonly ShownStroke[]): { strokes: ShownStroke[]; box: Box }[] {
  const boxed = strokes
    .filter((s) => s.points.length > 0)
    .map((stroke) => ({ stroke, box: strokeBox(stroke) }))
    .sort((a, b) => a.box.y0 + a.box.y1 - (b.box.y0 + b.box.y1));
  const rows: Row[] = [];
  for (const { stroke, box } of boxed) {
    const middle = (box.y0 + box.y1) / 2;
    const height = box.y1 - box.y0;
    let best: Row | null = null;
    let nearest = Infinity;
    for (const r of rows) {
      const distance = Math.abs(middle - median(r.middles));
      if (distance <= 0.75 * Math.max(median(r.heights), height) && distance < nearest) {
        [best, nearest] = [r, distance];
      }
    }
    if (best) {
      best.strokes.push(stroke);
      best.middles.push(middle);
      best.heights.push(height);
      best.box = {
        x0: Math.min(best.box.x0, box.x0),
        y0: Math.min(best.box.y0, box.y0),
        x1: Math.max(best.box.x1, box.x1),
        y1: Math.max(best.box.y1, box.y1),
      };
    } else rows.push({ strokes: [stroke], box, middles: [middle], heights: [height] });
  }
  return rows
    .sort((a, b) => a.box.y0 - b.box.y0)
    .slice(0, MAX_ROWS)
    .map(({ strokes: inRow, box }) => ({ strokes: inRow, box }));
}
