// Row heights, hiding lines, and freeze panes (DESIGN 3.1, 13.2). All of it is plain settings under `data.sheet`;
// the render lane draws them (sheet/render/draw.ts). Hiding keeps every cell's data.

import { ownObject, put, type JsonObject } from '../model/json';
import type { Sheet, TableLike } from '../model/types';
import { assign, edit, idsOf, setting, span, type Axis, type Edited } from './edit';

/** The range of a row height in page units (format spec: 1 to 10,000, two decimals). */
export const MIN_HEIGHT = 1;
export const MAX_HEIGHT = 10_000;

/** The height of a row that sets none, for Distribute rows when no measure is given. */
export const DEFAULT_ROW_HEIGHT = 28;

const clampHeight = (height: number): number =>
  Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, height)) * 100) / 100;

/**
 * Sets the height of rows: `exact` fixes it and clips, otherwise it is a minimum. `null` clears the height, so the row
 * fits its content again (the same as auto-fitting the row).
 */
export function setRowHeight(
  sheet: Sheet,
  table: TableLike,
  rows: readonly string[],
  height: number | null,
  exact = false,
): Edited {
  return edit(sheet, table, (s) => {
    for (const id of rows) {
      if (height === null || !Number.isFinite(height)) {
        assign(s, 'rows', id, 'height', undefined);
        assign(s, 'rows', id, 'exact', undefined);
      } else {
        assign(s, 'rows', id, 'height', clampHeight(height));
        assign(s, 'rows', id, 'exact', exact ? true : undefined);
      }
    }
  });
}

/** The stored height of a row, or null when it fits its content. */
export function rowHeight(sheet: Sheet, id: string): { height: number; exact: boolean } | null {
  const height = setting(sheet, 'rows', id, 'height');
  return typeof height === 'number' ? { height, exact: setting(sheet, 'rows', id, 'exact') === true } : null;
}

/** Heights that make the rows equal and keep their total, which is what Distribute rows does. */
export function distributedHeights(current: readonly number[]): number[] {
  if (current.length === 0) return [];
  const total = current.reduce((sum, h) => sum + h, 0);
  const each = clampHeight(total / current.length);
  return current.map(() => each);
}

/**
 * Equal heights for the rows from index `from` to `to`. `measured` gives each row's present height on screen, by
 * position in the range; a row with none uses its stored height, or the default.
 */
export function distributeRows(
  sheet: Sheet,
  table: TableLike,
  from: number,
  to: number,
  measured: readonly number[] = [],
): Edited {
  const ids = span(table, 'rows', from, to);
  const current = ids.map((id, i) => measured[i] ?? rowHeight(sheet, id)?.height ?? DEFAULT_ROW_HEIGHT);
  const heights = distributedHeights(current);
  return edit(sheet, table, (s) => {
    ids.forEach((id, i) => {
      assign(s, 'rows', id, 'height', heights[i]);
      assign(s, 'rows', id, 'exact', undefined);
    });
  });
}

/** Whether a line is hidden by the sheet's own setting. */
export function isHidden(sheet: Sheet, axis: Axis, id: string): boolean {
  return setting(sheet, axis, id, 'hidden') === true;
}

/** The indexes of the lines that show, in order. Keys and drawing both skip the others. */
export function visibleIndexes(sheet: Sheet, table: TableLike, axis: Axis): number[] {
  const out: number[] = [];
  idsOf(table, axis).forEach((id, i) => {
    if (!isHidden(sheet, axis, id)) out.push(i);
  });
  return out;
}

/** Hides the lines from index `from` to `to`; their data stays. */
export function hideLines(sheet: Sheet, table: TableLike, axis: Axis, from: number, to: number): Edited {
  const ids = span(table, axis, from, to);
  return edit(sheet, table, (s) => {
    for (const id of ids) assign(s, axis, id, 'hidden', true);
  });
}

/**
 * Shows the hidden lines from index `from` to `to` (Ctrl+Shift+9 and Ctrl+Shift+0 with the lines around them
 * selected). A line an outline group hid shows too, and its summary line no longer reads as collapsed.
 */
export function unhideLines(sheet: Sheet, table: TableLike, axis: Axis, from: number, to: number): Edited {
  const ids = span(table, axis, from, to);
  return edit(sheet, table, (s) => {
    for (const id of ids) {
      assign(s, axis, id, 'hidden', undefined);
      assign(s, axis, id, 'collapsed', undefined);
    }
  });
}

/** Shows every hidden line of the axis. */
export function unhideAll(sheet: Sheet, table: TableLike, axis: Axis): Edited {
  return unhideLines(sheet, table, axis, 0, idsOf(table, axis).length - 1);
}

/** The freeze setting: how many leading rows and columns stay in view. */
export function freezeOf(sheet: Sheet): { rows: number; cols: number } {
  const freeze = ownObject(ownObject(sheet, 'table'), 'freeze');
  const count = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : 0);
  return { rows: count(freeze?.rows), cols: count(freeze?.cols) };
}

/** Freezes the first `rows` rows and `cols` columns; zero for both removes the freeze. */
export function setFreeze(sheet: Sheet, table: TableLike, rows: number, cols: number): Edited {
  const whole = (n: number, max: number) => Math.min(max, Math.max(0, Number.isFinite(n) ? Math.floor(n) : 0));
  const r = whole(rows, table.rows.length);
  const c = whole(cols, table.columns.length);
  return edit(sheet, table, (s) => {
    let settings = ownObject(s, 'table');
    if (r === 0 && c === 0) {
      if (settings) delete settings.freeze;
      return;
    }
    if (!settings) {
      settings = {};
      put(s, 'table', settings);
    }
    put(settings, 'freeze', { rows: r, cols: c } as JsonObject);
  });
}
