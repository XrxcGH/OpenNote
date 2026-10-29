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

const strokeBox = (stroke: ShownStroke): Box => {
  const xs = stroke.points.map((p) => p.x);
  const ys = stroke.points.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
};

/** Strokes in rows: a stroke whose middle sits within a row's height (a little either way) joins it. */
export function rowsOf(strokes: readonly ShownStroke[]): { strokes: ShownStroke[]; box: Box }[] {
  const boxed = strokes
    .filter((s) => s.points.length > 0)
    .map((stroke) => ({ stroke, box: strokeBox(stroke) }))
    .sort((a, b) => a.box.y0 + a.box.y1 - (b.box.y0 + b.box.y1));
  const rows: { strokes: ShownStroke[]; box: Box }[] = [];
  for (const { stroke, box } of boxed) {
    const middle = (box.y0 + box.y1) / 2;
    const row = rows.find((r) => {
      const grow = (r.box.y1 - r.box.y0) * 0.25;
      return middle >= r.box.y0 - grow && middle <= r.box.y1 + grow;
    });
    if (row) {
      row.strokes.push(stroke);
      row.box = {
        x0: Math.min(row.box.x0, box.x0),
        y0: Math.min(row.box.y0, box.y0),
        x1: Math.max(row.box.x1, box.x1),
        y1: Math.max(row.box.y1, box.y1),
      };
    } else rows.push({ strokes: [stroke], box });
  }
  return rows.sort((a, b) => a.box.y0 - b.box.y0).slice(0, MAX_ROWS);
}
