// Draw a grid to make a table: after a few straight lines are drawn across each other in a grid, the page offers
// Convert to table, and the lasso and the palette offer it for a grid that is selected. The table has the grid's rows
// and columns, sits where the grid was, and replaces the drawn lines in one undo step. With handwriting recognition on,
// the writing in each cell is read into that cell in the same step; otherwise it stays where it is, as ink. The drawn
// lines are read as lines and rectangles by the shape recognizer, and the table is built by the editor's own table data.
import { newId } from '../../../editor/ids';
import { escapeParagraphText } from '../../../editor/markdown/escape';
import type { TableData } from '../../../editor/schema/specs';
import { isEnabled } from '../../../app/flags';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { strokeBounds } from '../geometry/bounds';
import { recognizeShape } from '../geometry/shapes';
import { pagePoints } from '../geometry/strokeIndex';
import type { InkStroke } from '../model/types';
import { handwritingAvailable, readText } from './handwriting';
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
  /** Where the grid's horizontal lines sit, top to bottom, and its vertical ones, left to right. */
  readonly rowLines: readonly number[];
  readonly columnLines: readonly number[];
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
    rowLines: rows,
    columnLines: columns,
  };
}

/** Which of the gaps between sorted lines a position falls in, or -1 outside them. */
function gapAt(lines: readonly number[], at: number): number {
  for (let i = 0; i + 1 < lines.length; i += 1) if (at >= lines[i] && at < lines[i + 1]) return i;
  return -1;
}

/** The cell a point is in, as "row:column", or null when it is outside the grid. */
export function cellAt(grid: Pick<Grid, 'rowLines' | 'columnLines'>, x: number, y: number): string | null {
  const row = gapAt(grid.rowLines, y);
  const column = gapAt(grid.columnLines, x);
  return row < 0 || column < 0 ? null : `${row}:${column}`;
}

/** The handwriting in each cell: every stroke but the grid's own lines and highlighter, by where its middle is. */
export function cellInk(grid: Grid, strokes: readonly InkStroke[]): Map<string, InkStroke[]> {
  const cells = new Map<string, InkStroke[]>();
  const lines = new Set(grid.ids);
  for (const stroke of strokes) {
    if (lines.has(stroke.id) || stroke.tool === 'highlighter') continue;
    const b = strokeBounds(stroke);
    const cell = cellAt(grid, (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
    if (cell) cells.set(cell, [...(cells.get(cell) ?? []), stroke]);
  }
  return cells;
}

/**
 * The words in each cell, read by `read` (the recognizer, or a stub in tests). A cell whose ink reads as nothing
 * keeps its ink. Returns the text by cell and the strokes that became text.
 */
export async function readCells(
  cells: ReadonlyMap<string, readonly InkStroke[]>,
  read: (strokes: readonly InkStroke[]) => Promise<string | null>,
): Promise<{ texts: Map<string, string>; used: string[] }> {
  const texts = new Map<string, string>();
  const used: string[] = [];
  for (const [cell, strokes] of cells) {
    const text = (await read(strokes))?.trim();
    if (!text) continue;
    texts.set(cell, text);
    used.push(...strokes.map((stroke) => stroke.id));
  }
  return { texts, used };
}

/** A table block's data (spec 6.3) with a column for each grid column, as wide as the grid drew them. */
export function tableData(
  grid: Pick<Grid, 'rows' | 'columns' | 'width'>,
  texts: ReadonlyMap<string, string> = new Map(),
): TableData {
  const width = Math.min(2000, Math.max(40, Math.round(grid.width / Math.max(1, grid.columns))));
  const columns = Array.from({ length: Math.max(1, grid.columns) }, () => ({ id: newId(), width }));
  const rows = Array.from({ length: Math.max(1, grid.rows) }, (_, row) => ({
    id: newId(),
    cells: Object.fromEntries(
      columns.map((column, index) => [
        column.id,
        { markdown: escapeParagraphText(texts.get(`${row}:${index}`) ?? '') },
      ]),
    ),
  }));
  return { header: false, columns, rows };
}

/** The ink over a grid that may be writing in its cells. */
function inkNear(surface: InkSurface, grid: Grid): InkStroke[] {
  return surface.index.query({
    minX: grid.x,
    minY: grid.y,
    maxX: grid.x + grid.width,
    maxY: grid.y + grid.height,
  }) as InkStroke[];
}

/**
 * Turns a grid into a table as one undo step: the lines go, the table comes, and with recognition on, the writing in
 * each cell becomes the cell's text. `candidates` are the strokes that may be cell writing; by default, the ink over
 * the grid. Returns whether the page took it.
 */
export async function convertGrid(
  host: InkHost,
  surface: InkSurface,
  grid: Grid,
  candidates: readonly InkStroke[] = inkNear(surface, grid),
): Promise<boolean> {
  const queue = host.queue.get();
  if (!queue || surface.readOnly) return false;
  if (handwritingAvailable(host)) announce(t('ink.handwriting.working'));
  const { texts, used } = handwritingAvailable(host)
    ? await readCells(cellInk(grid, candidates), (strokes) => readText(host, strokes))
    : { texts: new Map<string, string>(), used: [] as string[] };
  const removed = [...grid.ids, ...used];
  const gone = surface.hide(removed);
  const edits = [
    { edit: 'removeStrokes' as const, strokes: removed },
    {
      edit: 'insertBlock' as const,
      block: {
        id: newId(),
        type: 'table',
        frame: { x: grid.x, y: grid.y, w: Math.max(80, grid.width) },
        data: { ...tableData(grid, texts) },
      },
    },
  ];
  const ok = await surface.send({ edits }, () => surface.show(gone));
  if (ok) {
    const message =
      texts.size > 0
        ? t('ink.gridTable.convertedText', { rows: grid.rows, columns: grid.columns, cells: texts.size })
        : t('ink.gridTable.converted', { rows: grid.rows, columns: grid.columns });
    showToast({ id: 'ink-grid', message, action: { label: t('ink.gestures.undo'), run: () => queue.undo() } });
  }
  return ok;
}

/** The grid the selected strokes draw, for Convert to table on the lasso and in the palette. */
export function gridInSelection(strokes: readonly InkStroke[]): Grid | null {
  return findGrid(strokes.flatMap((stroke) => linesOf(stroke.id, pagePoints(stroke), 0)));
}

/** Convert to table for the lasso's selection: its grid, with the selected writing read into the cells. */
export async function convertSelectionToTable(host: InkHost, surface: InkSurface): Promise<void> {
  const strokes = surface.strokes(host.selection.get().strokes);
  const grid = gridInSelection(strokes);
  if (!grid) {
    showToast({ message: t('ink.gridTable.noGrid') });
    return;
  }
  host.select({ blocks: [], strokes: [] });
  await convertGrid(host, surface, grid, strokes);
}

export function createGridWatch(host: InkHost, surfaceOf: () => InkSurface | null) {
  let lines: GridLine[] = [];
  let offered = '';

  const convert = async (surface: InkSurface, grid: Grid) => {
    if (await convertGrid(host, surface, grid)) lines = lines.filter((line) => !grid.ids.includes(line.id));
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
