// The spreadsheet moves of a table's grid (ADR 0063), as pure functions of the cells' text. Ctrl+arrows jump to
// the edge of the data, Ctrl+End finds the last used cell, Ctrl+A finds the current region, and Enter and Tab
// cycle inside a range. A cell is filled when its text has anything but spaces.
import { lettersFromColumn } from '../../../core/expr';

/** A cell of the grid, counted from 0. Row 0 is the header row when the table has one. */
export interface GridCell {
  row: number;
  column: number;
}

/** A block of cells, inclusive on every side. */
export interface Box {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** The text of every cell, row by row. Rows may be short; a missing cell is empty. */
export type Texts = readonly (readonly string[])[];

export const heightOf = (texts: Texts): number => texts.length;
export const widthOf = (texts: Texts): number => Math.max(0, ...texts.map((row) => row.length));

const filled = (texts: Texts, row: number, column: number): boolean => (texts[row]?.[column] ?? '').trim() !== '';

const inside = (texts: Texts, row: number, column: number): boolean =>
  row >= 0 && column >= 0 && row < heightOf(texts) && column < widthOf(texts);

/** The box with `a` and `b` at opposite corners. */
export function boxOf(a: GridCell, b: GridCell): Box {
  return {
    top: Math.min(a.row, b.row),
    left: Math.min(a.column, b.column),
    bottom: Math.max(a.row, b.row),
    right: Math.max(a.column, b.column),
  };
}

export const boxSize = (box: Box): number => (box.bottom - box.top + 1) * (box.right - box.left + 1);

export const inBox = (box: Box, at: GridCell): boolean =>
  at.row >= box.top && at.row <= box.bottom && at.column >= box.left && at.column <= box.right;

/** One step in a direction, kept inside the grid. */
export function step(texts: Texts, from: GridCell, rows: number, columns: number): GridCell {
  const row = Math.min(Math.max(from.row + rows, 0), Math.max(heightOf(texts) - 1, 0));
  const column = Math.min(Math.max(from.column + columns, 0), Math.max(widthOf(texts) - 1, 0));
  return { row, column };
}

/**
 * Ctrl+arrow: the edge of the data in a direction. Inside a run of filled cells it stops at the run's last cell.
 * From an empty cell, or from the last cell of a run, it stops at the next filled cell, or at the grid's edge.
 */
export function jump(texts: Texts, from: GridCell, rows: -1 | 0 | 1, columns: -1 | 0 | 1): GridCell {
  let { row, column } = from;
  if (!inside(texts, row + rows, column + columns)) return { row, column };
  if (filled(texts, row, column) && filled(texts, row + rows, column + columns)) {
    while (inside(texts, row + rows, column + columns) && filled(texts, row + rows, column + columns)) {
      row += rows;
      column += columns;
    }
    return { row, column };
  }
  row += rows;
  column += columns;
  while (!filled(texts, row, column) && inside(texts, row + rows, column + columns)) {
    row += rows;
    column += columns;
  }
  return { row, column };
}

/** Ctrl+End: the last row that has data, in the last column that has data. A1 when the grid is empty. */
export function lastUsed(texts: Texts): GridCell {
  let row = 0;
  let column = 0;
  texts.forEach((line, r) =>
    line.forEach((_, c) => {
      if (!filled(texts, r, c)) return;
      row = Math.max(row, r);
      column = Math.max(column, c);
    }),
  );
  return { row, column };
}

/** Whether any cell of the box is filled. */
function anyFilled(texts: Texts, box: Box): boolean {
  for (let r = Math.max(box.top, 0); r <= box.bottom; r++)
    for (let c = Math.max(box.left, 0); c <= box.right; c++) if (filled(texts, r, c)) return true;
  return false;
}

/**
 * Ctrl+A: the current region, the block of data around a cell up to empty rows and columns, diagonals included.
 * An empty cell with no data next to it is a region of one cell.
 */
export function region(texts: Texts, at: GridCell): Box {
  const box: Box = { top: at.row, left: at.column, bottom: at.row, right: at.column };
  const last = { row: heightOf(texts) - 1, column: widthOf(texts) - 1 };
  for (let grew = true; grew;) {
    grew = false;
    const wide = { left: Math.max(box.left - 1, 0), right: Math.min(box.right + 1, last.column) };
    const tall = { top: Math.max(box.top - 1, 0), bottom: Math.min(box.bottom + 1, last.row) };
    if (box.top > 0 && anyFilled(texts, { ...wide, top: box.top - 1, bottom: box.top - 1 })) {
      box.top--;
      grew = true;
    }
    if (box.bottom < last.row && anyFilled(texts, { ...wide, top: box.bottom + 1, bottom: box.bottom + 1 })) {
      box.bottom++;
      grew = true;
    }
    if (box.left > 0 && anyFilled(texts, { ...tall, left: box.left - 1, right: box.left - 1 })) {
      box.left--;
      grew = true;
    }
    if (box.right < last.column && anyFilled(texts, { ...tall, left: box.right + 1, right: box.right + 1 })) {
      box.right++;
      grew = true;
    }
  }
  return box;
}

/**
 * Enter and Tab inside a range: the next cell of the box, wrapping. Enter goes down each column, then on to the
 * next column; Tab goes along each row, then on to the next row. `back` is Shift+Enter and Shift+Tab.
 */
export function cycle(box: Box, from: GridCell, by: 'column' | 'row', back = false): GridCell {
  const rows = box.bottom - box.top + 1;
  const columns = box.right - box.left + 1;
  const total = rows * columns;
  const index =
    by === 'column'
      ? (from.column - box.left) * rows + (from.row - box.top)
      : (from.row - box.top) * columns + (from.column - box.left);
  const next = (index + (back ? -1 : 1) + total) % total;
  return by === 'column'
    ? { row: box.top + (next % rows), column: box.left + Math.floor(next / rows) }
    : { row: box.top + Math.floor(next / columns), column: box.left + (next % columns) };
}

/**
 * The cell's address, as formulas name it: "C4". With a header row, the header row has no number and the first
 * row under it is row 1, so formulas see the data as a sheet does. The header row's address is the column alone.
 */
export function address(at: GridCell, header: boolean): string {
  const letters = lettersFromColumn(at.column);
  if (header && at.row === 0) return letters;
  return `${letters}${header ? at.row : at.row + 1}`;
}
