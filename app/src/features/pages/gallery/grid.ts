// The page gallery's grid: how many columns fit, where each thumbnail sits, which are on screen, where a drop lands,
// and where the arrow keys go. All of it is arithmetic over CSS pixels, so the view only draws what this says.

import type { Rect } from '../pagination/geometry';

export interface GridOptions {
  /** The width available, in CSS pixels. */
  readonly width: number;
  readonly count: number;
  /** The narrowest a cell may get. Default 160. */
  readonly minCell?: number;
  /** The space between cells. Default 16. */
  readonly gap?: number;
  /** A thumbnail's height as a share of its width. Default 11 / 8.5, a letter page. */
  readonly aspect?: number;
  /** The height under a thumbnail for the title and the date. Default 48. */
  readonly caption?: number;
  readonly maxColumns?: number;
}

export interface GridLayout {
  readonly columns: number;
  readonly rows: number;
  readonly count: number;
  readonly gap: number;
  readonly cellWidth: number;
  readonly thumbHeight: number;
  readonly cellHeight: number;
  /** The height of the whole grid. */
  readonly height: number;
}

/** The grid for a width: as many columns as fit at the narrowest cell, each as wide as the space allows. */
export function gridLayout(options: GridOptions): GridLayout {
  const { width, count } = options;
  const minCell = options.minCell ?? 160;
  const gap = options.gap ?? 16;
  const aspect = options.aspect ?? 11 / 8.5;
  const caption = options.caption ?? 48;
  const fit = Math.floor((Math.max(width, 0) + gap) / (minCell + gap));
  const columns = Math.min(Math.max(fit, 1), options.maxColumns ?? 8, Math.max(count, 1));
  const cellWidth = Math.max((width - gap * (columns - 1)) / columns, 1);
  const thumbHeight = cellWidth * aspect;
  const cellHeight = thumbHeight + caption;
  const rows = Math.ceil(count / columns);
  return {
    columns,
    rows,
    count,
    gap,
    cellWidth,
    thumbHeight,
    cellHeight,
    height: rows === 0 ? 0 : rows * cellHeight + (rows - 1) * gap,
  };
}

/** Where cell `index` sits, from the grid's top-left corner. */
export function cellRect(layout: GridLayout, index: number): Rect {
  const row = Math.floor(index / layout.columns);
  const column = index % layout.columns;
  return {
    x: column * (layout.cellWidth + layout.gap),
    y: row * (layout.cellHeight + layout.gap),
    w: layout.cellWidth,
    h: layout.cellHeight,
  };
}

/** The cells to draw for a scroll position: from `first` up to but not including `end`, with `overscan` extra rows. */
export function visibleRange(
  layout: GridLayout,
  scrollTop: number,
  viewportHeight: number,
  overscan = 1,
): { first: number; end: number } {
  if (layout.count === 0) return { first: 0, end: 0 };
  const stride = layout.cellHeight + layout.gap;
  const firstRow = Math.max(Math.floor(scrollTop / stride) - overscan, 0);
  const lastRow = Math.min(Math.floor((scrollTop + viewportHeight) / stride) + overscan, layout.rows - 1);
  return { first: firstRow * layout.columns, end: Math.min((lastRow + 1) * layout.columns, layout.count) };
}

/** The cell under a point, or null in a gap or past the last cell. */
export function indexAt(layout: GridLayout, x: number, y: number): number | null {
  const column = Math.floor(x / (layout.cellWidth + layout.gap));
  const row = Math.floor(y / (layout.cellHeight + layout.gap));
  if (x < 0 || y < 0 || column >= layout.columns) return null;
  const index = row * layout.columns + column;
  if (index >= layout.count) return null;
  const r = cellRect(layout, index);
  return x <= r.x + r.w && y <= r.y + r.h ? index : null;
}

/**
 * The slot a dragged thumbnail would drop into, from 0 (before the first page) to `count` (after the last). It is the
 * gap nearest the point: before a cell when the point is in its left half, after it otherwise.
 */
export function dropSlot(layout: GridLayout, x: number, y: number): number {
  if (layout.count === 0) return 0;
  const stride = layout.cellHeight + layout.gap;
  const row = Math.min(Math.max(Math.floor(y / stride), 0), layout.rows - 1);
  const column = Math.min(
    Math.max(Math.floor((x + layout.gap / 2) / (layout.cellWidth + layout.gap)), 0),
    layout.columns - 1,
  );
  const index = row * layout.columns + column;
  const inLeftHalf = x - column * (layout.cellWidth + layout.gap) < layout.cellWidth / 2;
  return Math.min(inLeftHalf ? index : index + 1, layout.count);
}

export type GridKey = 'left' | 'right' | 'up' | 'down' | 'home' | 'end' | 'pageUp' | 'pageDown';

/** The cell an arrow key, Home, End, Page Up, or Page Down goes to. Left and right wrap from row to row. */
export function moveGridFocus(layout: GridLayout, index: number, key: GridKey, rowsPerPage = 3): number {
  const last = layout.count - 1;
  if (last < 0) return -1;
  const here = Math.min(Math.max(index, 0), last);
  const sideways = (n: number) => Math.min(Math.max(here + n, 0), last);
  switch (key) {
    case 'left':
      return sideways(-1);
    case 'right':
      return sideways(1);
    case 'up':
      return sideways(-layout.columns);
    case 'down':
      // The row below may be shorter, so the key goes to its last cell rather than doing nothing.
      return Math.floor(here / layout.columns) < layout.rows - 1 ? Math.min(here + layout.columns, last) : here;
    case 'pageUp':
      return sideways(-layout.columns * rowsPerPage);
    case 'pageDown':
      return Math.min(here + layout.columns * rowsPerPage, last);
    case 'home':
      return 0;
    case 'end':
      return last;
  }
}

/** The indexes from the anchor to the clicked cell, in order, for a shift-click. */
export function rangeBetween(anchor: number, index: number): number[] {
  const [from, to] = anchor <= index ? [anchor, index] : [index, anchor];
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}
