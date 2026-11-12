// Shared pieces of the structure commands (DESIGN 3.1): edit a copy of the sheet, tidy it, and give one merge patch.
// Row and column settings live under `rows` and `cols` by ID, so they follow a line when lines are inserted, deleted,
// or moved. A line with no settings left is removed so the file stays small.

import { clone, isObject, ownObject, put, type Json, type JsonObject } from '../model/json';
import { sheetPatch, tidy } from '../model/sheet';
import type { Sheet, TableLike } from '../model/types';

/** A line is a row or a column. */
export type Axis = 'rows' | 'cols';

export interface Edited {
  sheet: Sheet;
  /** The merge patch of the block's data, or null when nothing changed. */
  patch: JsonObject | null;
}

/** The most levels an outline has (format spec: level 0 to 7). */
export const MAX_LEVEL = 7;

/** Removes settings objects that hold nothing, so an undone setting leaves no trace. */
export function dropEmpty(sheet: Sheet): void {
  for (const key of ['rows', 'cols']) {
    const map = ownObject(sheet, key);
    if (!map) continue;
    for (const id of Object.keys(map)) if (isObject(map[id]) && Object.keys(map[id]).length === 0) delete map[id];
    if (Object.keys(map).length === 0) delete sheet[key];
  }
  const table = ownObject(sheet, 'table');
  if (table && Object.keys(table).length === 0) delete sheet.table;
}

/** Runs `command` on a copy of the sheet, tidies it against `table`, and diffs. */
export function edit(before: Sheet, table: TableLike, command: (sheet: Sheet) => void): Edited {
  const sheet = clone(before);
  command(sheet);
  dropEmpty(sheet);
  tidy(sheet, table);
  return { sheet, patch: sheetPatch(before, sheet) };
}

/** The settings object of one line, made when it is missing. */
export function settingsOf(sheet: Sheet, axis: Axis, id: string): JsonObject {
  let map = ownObject(sheet, axis);
  if (!map) {
    map = {};
    put(sheet, axis, map);
  }
  let one = ownObject(map, id);
  if (!one) {
    one = {};
    put(map, id, one);
  }
  return one;
}

/** One setting of a line, read without making anything. */
export function setting(sheet: Sheet, axis: Axis, id: string, key: string): Json | undefined {
  const one = ownObject(ownObject(sheet, axis), id);
  return one && Object.prototype.hasOwnProperty.call(one, key) ? one[key] : undefined;
}

/** Sets a setting of a line, or removes it when `value` is undefined. */
export function assign(sheet: Sheet, axis: Axis, id: string, key: string, value: Json | undefined): void {
  if (value === undefined) {
    const one = ownObject(ownObject(sheet, axis), id);
    if (one) delete one[key];
    return;
  }
  put(settingsOf(sheet, axis, id), key, value);
}

/** The IDs of a table's lines. */
export function idsOf(table: TableLike, axis: Axis): string[] {
  return axis === 'rows' ? table.rows.map((r) => r.id) : table.columns.map((c) => c.id);
}

/** The IDs of the lines from index `from` to `to`, both included, in either order. */
export function span(table: TableLike, axis: Axis, from: number, to: number): string[] {
  const ids = idsOf(table, axis);
  const a = Math.max(0, Math.min(from, to));
  const b = Math.min(ids.length - 1, Math.max(from, to));
  return ids.slice(a, b + 1);
}
