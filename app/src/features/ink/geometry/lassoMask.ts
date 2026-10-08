// A coarse raster of the lasso polygon (design 9.3). Each cell is inside, outside, or an edge cell that an edge of the
// polygon crosses. Running sums over the cells tell in one step whether a stroke's box lies wholly inside the lasso,
// wholly outside it, or needs an exact test. A lasso over 10,000 strokes then tests points for only a few.

import { boundsOf } from './bounds';
import { pointInPolygon } from './primitives';
import type { Bounds, Vec } from './types';

export const OUTSIDE = 0;
export const INSIDE = 1;
export const EDGE = 2;

export interface MaskOptions {
  /** The most cells along either side. Defaults to 128. */
  readonly maxCells?: number;
  /** The smallest cell, in page units. Callers pass one screen pixel. Defaults to 1. */
  readonly minCell?: number;
}

export interface LassoMask {
  readonly polygon: readonly Vec[];
  readonly originX: number;
  readonly originY: number;
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  readonly state: Uint8Array;
  /** Running sums, (cols + 1) × (rows + 1): cells that are not inside, and cells that are not outside. */
  readonly notInside: Int32Array;
  readonly notOutside: Int32Array;
}

export type BoxClass = 'inside' | 'outside' | 'mixed';

export function buildMask(polygon: readonly Vec[], options: MaskOptions = {}): LassoMask {
  const box = boundsOf(polygon);
  const { maxCells = 128, minCell = 1 } = options;
  const cell = Math.max(minCell, Math.hypot(box.maxX - box.minX, box.maxY - box.minY) / maxCells);
  const cols = Math.ceil((box.maxX - box.minX) / cell) + 1;
  const rows = Math.ceil((box.maxY - box.minY) / cell) + 1;
  const state = new Uint8Array(cols * rows);
  const grid = { ox: box.minX, oy: box.minY, cell, cols, rows };
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) markEdge(state, grid, polygon[j], polygon[i]);
  fillInside(state, grid, polygon);
  const { notInside, notOutside } = runningSums(state, cols, rows);
  return { polygon, originX: box.minX, originY: box.minY, cell, cols, rows, state, notInside, notOutside };
}

interface Grid {
  readonly ox: number;
  readonly oy: number;
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
}

/** Marks every cell the segment passes through as an edge cell, stepping cell by cell along it. */
function markEdge(state: Uint8Array, g: Grid, a: Vec, b: Vec): void {
  const ax = (a.x - g.ox) / g.cell;
  const ay = (a.y - g.oy) / g.cell;
  const dx = (b.x - g.ox) / g.cell - ax;
  const dy = (b.y - g.oy) / g.cell - ay;
  const clampX = (v: number) => Math.min(g.cols - 1, Math.max(0, v));
  const clampY = (v: number) => Math.min(g.rows - 1, Math.max(0, v));
  let x = clampX(Math.floor(ax));
  let y = clampY(Math.floor(ay));
  const endX = clampX(Math.floor(ax + dx));
  const endY = clampY(Math.floor(ay + dy));
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  let nextX = dx === 0 ? Infinity : ((stepX > 0 ? x + 1 : x) - ax) / dx;
  let nextY = dy === 0 ? Infinity : ((stepY > 0 ? y + 1 : y) - ay) / dy;
  const deltaX = dx === 0 ? Infinity : stepX / dx;
  const deltaY = dy === 0 ? Infinity : stepY / dy;
  for (let guard = Math.abs(endX - x) + Math.abs(endY - y) + 2; guard > 0; guard--) {
    state[y * g.cols + x] = EDGE;
    if (x === endX && y === endY) return;
    if (nextX < nextY) {
      x = clampX(x + stepX);
      nextX += deltaX;
    } else {
      y = clampY(y + stepY);
      nextY += deltaY;
    }
  }
}

/** Fills the cells whose centers lie inside the polygon by the nonzero rule, leaving edge cells as they are. */
function fillInside(state: Uint8Array, g: Grid, polygon: readonly Vec[]): void {
  const crossings: { x: number; dir: number }[][] = Array.from({ length: g.rows }, () => []);
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j];
    const b = polygon[i];
    if (a.y === b.y) continue;
    const lo = Math.max(0, Math.ceil((Math.min(a.y, b.y) - g.oy) / g.cell - 0.5));
    const hi = Math.min(g.rows - 1, Math.floor((Math.max(a.y, b.y) - g.oy) / g.cell - 0.5));
    for (let row = lo; row <= hi; row++) {
      const y = g.oy + (row + 0.5) * g.cell;
      if (a.y <= y === b.y <= y) continue;
      crossings[row].push({ x: a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x), dir: b.y > a.y ? 1 : -1 });
    }
  }
  crossings.forEach((row, r) => fillRow(state, g, r, row));
}

function fillRow(state: Uint8Array, g: Grid, r: number, row: { x: number; dir: number }[]): void {
  row.sort((p, q) => p.x - q.x);
  let winding = 0;
  for (let k = 0; k + 1 < row.length; k++) {
    winding += row[k].dir;
    if (winding === 0) continue;
    const from = Math.max(0, Math.ceil((row[k].x - g.ox) / g.cell - 0.5));
    const to = Math.min(g.cols - 1, Math.ceil((row[k + 1].x - g.ox) / g.cell - 0.5) - 1);
    for (let c = from; c <= to; c++) if (state[r * g.cols + c] === OUTSIDE) state[r * g.cols + c] = INSIDE;
  }
}

function runningSums(state: Uint8Array, cols: number, rows: number) {
  const stride = cols + 1;
  const notInside = new Int32Array(stride * (rows + 1));
  const notOutside = new Int32Array(stride * (rows + 1));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const s = state[r * cols + c];
      const at = (r + 1) * stride + c + 1;
      notInside[at] = (s === INSIDE ? 0 : 1) + notInside[at - 1] + notInside[at - stride] - notInside[at - stride - 1];
      notOutside[at] =
        (s === OUTSIDE ? 0 : 1) + notOutside[at - 1] + notOutside[at - stride] - notOutside[at - stride - 1];
    }
  }
  return { notInside, notOutside };
}

interface CellRange {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** The sum over a range of cells, read from a table of running sums. */
function rangeSum(sums: Int32Array, stride: number, r: CellRange): number {
  return (
    sums[(r.y1 + 1) * stride + r.x1 + 1] -
    sums[r.y0 * stride + r.x1 + 1] -
    sums[(r.y1 + 1) * stride + r.x0] +
    sums[r.y0 * stride + r.x0]
  );
}

/** Whether a box lies wholly inside the lasso, wholly outside it, or crosses its edge. */
export function classifyBox(mask: LassoMask, box: Bounds): BoxClass {
  const c0 = Math.floor((box.minX - mask.originX) / mask.cell);
  const c1 = Math.floor((box.maxX - mask.originX) / mask.cell);
  const r0 = Math.floor((box.minY - mask.originY) / mask.cell);
  const r1 = Math.floor((box.maxY - mask.originY) / mask.cell);
  const spills = c0 < 0 || r0 < 0 || c1 >= mask.cols || r1 >= mask.rows;
  const range = {
    x0: Math.max(0, c0),
    y0: Math.max(0, r0),
    x1: Math.min(mask.cols - 1, c1),
    y1: Math.min(mask.rows - 1, r1),
  };
  if (range.x0 > range.x1 || range.y0 > range.y1) return 'outside';
  const stride = mask.cols + 1;
  if (rangeSum(mask.notOutside, stride, range) === 0) return 'outside';
  if (!spills && rangeSum(mask.notInside, stride, range) === 0) return 'inside';
  return 'mixed';
}

/** The cell state under a point: OUTSIDE, INSIDE, or EDGE, which needs an exact test. */
export function stateAt(mask: LassoMask, x: number, y: number): number {
  const c = Math.floor((x - mask.originX) / mask.cell);
  const r = Math.floor((y - mask.originY) / mask.cell);
  if (c < 0 || r < 0 || c >= mask.cols || r >= mask.rows) return OUTSIDE;
  return mask.state[r * mask.cols + c];
}

/** True when the point is inside the lasso. The mask answers for whole cells, and edge cells need the exact test. */
export function insideMask(mask: LassoMask, x: number, y: number): boolean {
  const state = stateAt(mask, x, y);
  return state === INSIDE || (state === EDGE && pointInPolygon({ x, y }, mask.polygon));
}
