// Positions of rows and columns by ID, and boxes between corner cells. Every map of `data.sheet` is keyed by IDs
// (R-SHT-2), so the model turns IDs into positions in the table's current order here.

import type { TableLike } from './types';

/** A box of cells by position, both ends included. */
export interface Box {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface Grid {
  rows: string[];
  cols: string[];
  rowAt: Map<string, number>;
  colAt: Map<string, number>;
}

const cache = new WeakMap<TableLike, Grid>();

/** The table's row and column IDs in order, with their positions. A table is read once per object. */
export function gridOf(table: TableLike): Grid {
  const known = cache.get(table);
  if (known) return known;
  const rows = table.rows.map((row) => row.id);
  const cols = table.columns.map((col) => col.id);
  const grid: Grid = {
    rows,
    cols,
    rowAt: new Map(rows.map((id, i) => [id, i])),
    colAt: new Map(cols.map((id, i) => [id, i])),
  };
  cache.set(table, grid);
  return grid;
}

/** The box between two corner cells, in either order, or null when a corner names a missing row or column. */
export function boxOf(grid: Grid, from: unknown, to: unknown): Box | null {
  if (!isCorner(from) || !isCorner(to)) return null;
  const r1 = grid.rowAt.get(from[0]);
  const c1 = grid.colAt.get(from[1]);
  const r2 = grid.rowAt.get(to[0]);
  const c2 = grid.colAt.get(to[1]);
  if (r1 === undefined || c1 === undefined || r2 === undefined || c2 === undefined) return null;
  return { top: Math.min(r1, r2), bottom: Math.max(r1, r2), left: Math.min(c1, c2), right: Math.max(c1, c2) };
}

export function isCorner(value: unknown): value is [string, string] {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'string';
}

export function overlaps(a: Box, b: Box): boolean {
  return !(a.bottom < b.top || b.bottom < a.top || a.right < b.left || b.right < a.left);
}

export function contains(box: Box, row: number, col: number): boolean {
  return row >= box.top && row <= box.bottom && col >= box.left && col <= box.right;
}

export function isSingle(box: Box): boolean {
  return box.top === box.bottom && box.left === box.right;
}

/** The corners of a box as IDs: the top-left cell first. */
export function cornersOf(grid: Grid, box: Box): { from: [string, string]; to: [string, string] } {
  return {
    from: [grid.rows[box.top], grid.cols[box.left]],
    to: [grid.rows[box.bottom], grid.cols[box.right]],
  };
}
