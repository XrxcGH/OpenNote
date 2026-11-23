// Draw border and Erase border (DESIGN.md section 12): a stroke of the mouse or pen follows the gridlines. Each
// stretch of the stroke snaps to the nearest gridline along its dominant direction and sets that line on the cells
// on both sides (R-SHT-7: a border belongs to the cell it is a side of, so a shared line is written twice).
import type { GridCell } from '../keys/grid';

export type Side = 't' | 'r' | 'b' | 'l';

export interface Point {
  x: number;
  y: number;
}

/** The gridlines of the table: the x of each column edge (columns + 1 values) and the y of each row edge. */
export interface Lines {
  xs: readonly number[];
  ys: readonly number[];
  /** The table row of each span of `ys`, when the drawn rows are not all the rows (a virtual table). */
  rows?: readonly number[];
}

export interface Edge {
  cell: GridCell;
  side: Side;
}

/** The index of the value in `lines` nearest to `at`. */
function nearest(lines: readonly number[], at: number): number {
  let best = 0;
  lines.forEach((line, i) => {
    if (Math.abs(line - at) < Math.abs(lines[best] - at)) best = i;
  });
  return best;
}

/** The spans of `lines` (between neighbors) that a stretch from `a` to `b` covers by at least half. */
function covered(lines: readonly number[], a: number, b: number): number[] {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const out: number[] = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    const overlap = Math.min(hi, lines[i + 1]) - Math.max(lo, lines[i]);
    if (overlap > 0 && overlap * 2 >= lines[i + 1] - lines[i]) out.push(i);
  }
  return out;
}

/**
 * The cell sides a stroke draws or erases. A stretch that runs more across than up is a horizontal line; the other
 * stretches are vertical. Stretches shorter than `slop` pixels are noise from the pen.
 */
export function edgesAlong(stroke: readonly Point[], lines: Lines, slop = 4): Edge[] {
  const rows = lines.ys.length - 1;
  const columns = lines.xs.length - 1;
  const seen = new Set<string>();
  const edges: Edge[] = [];
  const add = (row: number, column: number, side: Side) => {
    if (row < 0 || column < 0 || row >= rows || column >= columns) return;
    const key = `${row},${column},${side}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ cell: { row: lines.rows?.[row] ?? row, column }, side });
  };
  // Group the stroke into runs that go the same way, so a corner makes two lines.
  let run: Point[] = [];
  const runs: Point[][] = [];
  let horizontal: boolean | null = null;
  for (let i = 1; i < stroke.length; i++) {
    const dx = Math.abs(stroke[i].x - stroke[i - 1].x);
    const dy = Math.abs(stroke[i].y - stroke[i - 1].y);
    if (dx + dy === 0) continue;
    const goes = dx >= dy;
    if (horizontal !== goes) {
      if (run.length > 0) runs.push(run);
      run = [stroke[i - 1]];
      horizontal = goes;
    }
    run.push(stroke[i]);
  }
  if (run.length > 1) runs.push(run);
  for (const points of runs) {
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const wide = Math.max(...xs) - Math.min(...xs);
    const tall = Math.max(...ys) - Math.min(...ys);
    if (Math.max(wide, tall) < slop) continue;
    if (wide >= tall) {
      const line = nearest(lines.ys, ys.reduce((a, b) => a + b, 0) / ys.length);
      for (const column of covered(lines.xs, Math.min(...xs), Math.max(...xs))) {
        add(line - 1, column, 'b');
        add(line, column, 't');
      }
    } else {
      const line = nearest(lines.xs, xs.reduce((a, b) => a + b, 0) / xs.length);
      for (const row of covered(lines.ys, Math.min(...ys), Math.max(...ys))) {
        add(row, line - 1, 'r');
        add(row, line, 'l');
      }
    }
  }
  return edges;
}
