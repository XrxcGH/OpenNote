// Draw a grid to make a table: after a few straight lines are drawn across each other in a grid, the page offers
// Convert to table. The table has the grid's rows and columns, sits where the grid was, and replaces the drawn lines in
// one undo step. Handwriting inside the cells stays where it is, as ink. The drawn lines are read as lines and
// rectangles by the shape recognizer, and the table is built by the editor's own table data.
import { newId } from '../../../editor/ids';
import type { TableData } from '../../../editor/schema/specs';
import { isEnabled } from '../../../app/flags';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { recognizeShape } from '../geometry/shapes';
import { pagePoints } from '../geometry/strokeIndex';
import type { InkStroke } from '../model/types';
import type { InkHost } from './host';
import type { InkSurface } from './surface';

export interface GridLine {
  readonly id: string;
  readonly axis: 'h' | 'v';
  /** The position across: y for a horizontal line, x for a vertical one. */
  readonly at: number;
  /** The extent along the line. */
  readonly from: number;
  readonly to: number;
  readonly time: number;
}

export interface Grid {
  readonly rows: number;
  readonly columns: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly ids: readonly string[];
}

/** Lines drawn within this long of each other can make a grid. */
export const GRID_WINDOW_MS = 30_000;
const AXIS_TOLERANCE = 15 * (Math.PI / 180);

/** The lines a stroke draws: a straight one is one line, and a rectangle is its four sides. */
export function linesOf(id: string, points: readonly { x: number; y: number }[], time: number): GridLine[] {
  const match = recognizeShape(points, { minSize: 30 });
  if (!match) return [];
  const make = (axis: 'h' | 'v', at: number, a: number, b: number): GridLine => ({
    id,
    axis,
    at,
    from: Math.min(a, b),
    to: Math.max(a, b),
    time,
  });
  if (match.shape.kind === 'line') {
    const { from, to } = match.shape;
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const flat = Math.min(Math.abs(angle), Math.PI - Math.abs(angle));
    if (flat <= AXIS_TOLERANCE) return [make('h', (from.y + to.y) / 2, from.x, to.x)];
    if (Math.abs(Math.abs(angle) - Math.PI / 2) <= AXIS_TOLERANCE)
      return [make('v', (from.x + to.x) / 2, from.y, to.y)];
    return [];
  }
  if (match.shape.kind === 'rectangle') {
    const xs = match.shape.corners.map((c) => c.x);
    const ys = match.shape.corners.map((c) => c.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    return [make('h', y0, x0, x1), make('h', y1, x0, x1), make('v', x0, y0, y1), make('v', x1, y0, y1)];
  }
  return [];
}

/** Lines at nearly the same place are one line of the grid. */
function groups(lines: readonly GridLine[], tolerance: number): number[] {
  const sorted = lines.map((line) => line.at).sort((a, b) => a - b);
  const merged: number[][] = [];
  for (const at of sorted) {
    const last = merged[merged.length - 1];
    if (last && at - last[last.length - 1] <= tolerance) last.push(at);
    else merged.push([at]);
  }
  return merged.map((one) => one.reduce((s, v) => s + v, 0) / one.length);
}

/** The grid that the lines make, if they make one: at least two rows and two columns, with lines that cross. */
export function findGrid(lines: readonly GridLine[]): Grid | null {
  const h = lines.filter((line) => line.axis === 'h');
  const v = lines.filter((line) => line.axis === 'v');
  if (h.length < 3 || v.length < 3) return null;
  const spanX = Math.max(...v.map((line) => line.at)) - Math.min(...v.map((line) => line.at));
  const spanY = Math.max(...h.map((line) => line.at)) - Math.min(...h.map((line) => line.at));
  const rows = groups(h, Math.max(10, spanY * 0.06));
  const columns = groups(v, Math.max(10, spanX * 0.06));
  if (rows.length < 3 || columns.length < 3) return null;
  const [y0, y1] = [rows[0], rows[rows.length - 1]];
  const [x0, x1] = [columns[0], columns[columns.length - 1]];
  // Each line has to reach most of the way across the grid, or the lines are just scattered.
  const reaches = (line: GridLine, lo: number, hi: number) =>
    Math.min(line.to, hi) - Math.max(line.from, lo) >= 0.6 * (hi - lo);
  const across = h.filter((line) => reaches(line, x0, x1));
  const down = v.filter((line) => reaches(line, y0, y1));
  if (across.length < 3 || down.length < 3) return null;
  const inside = [...across, ...down];
  return {
    rows: rows.length - 1,
    columns: columns.length - 1,
    x: x0,
    y: y0,
    width: x1 - x0,
    height: y1 - y0,
    ids: [...new Set(inside.map((line) => line.id))],
  };
}

/** A table block's data (spec 6.3) with a column for each grid column, as wide as the grid drew them. */
export function tableData(grid: Pick<Grid, 'rows' | 'columns' | 'width'>): TableData {
  const width = Math.min(2000, Math.max(40, Math.round(grid.width / Math.max(1, grid.columns))));
  const columns = Array.from({ length: Math.max(1, grid.columns) }, () => ({ id: newId(), width }));
  const cells = Object.fromEntries(columns.map((column) => [column.id, { markdown: '' }]));
  const rows = Array.from({ length: Math.max(1, grid.rows) }, () => ({ id: newId(), cells: { ...cells } }));
  return { header: false, columns, rows };
}

export function createGridWatch(host: InkHost, surfaceOf: () => InkSurface | null) {
  let lines: GridLine[] = [];
  let offered = '';

  const convert = async (surface: InkSurface, grid: Grid) => {
    const queue = host.queue.get();
    if (!queue) return;
    const gone = surface.hide(grid.ids as string[]);
    const edits = [
      { edit: 'removeStrokes' as const, strokes: [...grid.ids] },
      {
        edit: 'insertBlock' as const,
        block: {
          id: newId(),
          type: 'table' as const,
          frame: { x: grid.x, y: grid.y, w: Math.max(80, grid.width) },
          data: { ...tableData(grid) },
        },
      },
    ];
    const ok = await surface.send({ edits }, () => surface.show(gone));
    if (ok) {
      lines = lines.filter((line) => !grid.ids.includes(line.id));
      announce(t('ink.gridTable.converted', { rows: grid.rows, columns: grid.columns }));
    }
  };

  return {
    /** A stroke was added. When it completes a grid, the page offers a table. */
    note(stroke: InkStroke | undefined): void {
      const surface = surfaceOf();
      if (!stroke || !surface || surface.readOnly || !isEnabled('ink.gridTable') || !host.queue.get()) return;
      const now = Date.now();
      lines = lines.filter((line) => now - line.time < GRID_WINDOW_MS && surface.index.has(line.id));
      lines.push(...linesOf(stroke.id, pagePoints(stroke), now));
      const grid = findGrid(lines);
      const signature = grid ? `${grid.ids.slice().sort().join()}` : '';
      if (!grid || signature === offered) return;
      offered = signature;
      showToast({
        id: 'ink-grid',
        message: t('ink.gridTable.offer', { rows: grid.rows, columns: grid.columns }),
        action: { label: t('ink.gridTable.convert'), run: () => convert(surface, grid) },
      });
    },
  };
}

export type GridWatch = ReturnType<typeof createGridWatch>;
