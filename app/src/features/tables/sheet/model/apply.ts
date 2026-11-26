// Applying formatting to cells, rows, columns, and the whole table (DESIGN 3.3). Excel copies a row or column format
// onto every cell when it is applied, so a format applied later wins. The model gets the same result without a
// style per cell. Applying a property to a row or column removes it from the cells inside. Applying it to a column
// also sets it on the cells where a row style sets it, since the row layer lies above the column layer. Each command
// returns the new sheet and one merge patch, with unused styles removed in the same patch.

import { boxOf, gridOf, type Box } from './grid';
import { clone, isObject, own, ownObject, put, type Json, type JsonObject } from './json';
import { sheetPatch, tidy } from './sheet';
import { intern, StyleLimitError } from './styles';
import type { CellStyle, Sheet, StyleChange, TableLike } from './types';

/** The keys whose values are objects of properties; the others (`fmt`, `fill`) are one property each. */
const GROUPS = new Set(['font', 'border', 'align', 'pad', 'protect']);

export interface Applied {
  sheet: Sheet;
  /** The merge patch of the block's data, or null when nothing changed. */
  patch: JsonObject | null;
  /** Set when the change would pass the limit of 4,096 styles; the sheet is then unchanged. */
  refused?: 'styles';
}

/** Runs a command on a copy of the sheet and tidies it, or gives the sheet back unchanged at the style limit. */
function run(before: Sheet, table: TableLike, command: (sheet: Sheet) => void): Applied {
  const sheet = clone(before);
  try {
    command(sheet);
  } catch (error) {
    if (error instanceof StyleLimitError) return { sheet: before, patch: null, refused: 'styles' };
    throw error;
  }
  dropEmpty(sheet);
  tidy(sheet, table);
  return { sheet, patch: sheetPatch(before, sheet) };
}

/** `style` with `change` applied: values set properties, `null` clears them. */
export function changeStyle(style: CellStyle | JsonObject | undefined, change: StyleChange): JsonObject {
  const out: JsonObject = isObject(style) ? clone(style as JsonObject) : {};
  for (const [key, value] of Object.entries(change) as [string, Json | undefined][]) {
    if (value === undefined) continue;
    if (value === null) delete out[key];
    else if (GROUPS.has(key) && isObject(value)) {
      const group: JsonObject = ownObject(out, key) ?? {};
      for (const [inner, v] of Object.entries(value)) {
        if (v === null) delete group[inner];
        else if (v !== undefined) put(group, inner, clone(v));
      }
      if (Object.keys(group).length > 0) put(out, key, group);
      else delete out[key];
    } else put(out, key, clone(value));
  }
  return out;
}

/** `style` without the properties that `change` names, whatever their new values. */
export function clearProperties(style: CellStyle | JsonObject | undefined, change: StyleChange): JsonObject {
  const out: JsonObject = isObject(style) ? clone(style as JsonObject) : {};
  for (const [key, value] of Object.entries(change) as [string, Json | undefined][]) {
    if (value === undefined) continue;
    const group = ownObject(out, key);
    if (GROUPS.has(key) && isObject(value) && group) {
      for (const inner of Object.keys(value)) if (value[inner] !== undefined) delete group[inner];
      if (Object.keys(group).length === 0) delete out[key];
    } else delete out[key];
  }
  return out;
}

/** True when `style` sets one of the properties that `change` names. */
export function setsAny(style: Json | undefined, change: StyleChange): boolean {
  if (!isObject(style)) return false;
  return (Object.entries(change) as [string, Json | undefined][]).some(([key, value]) => {
    if (value === undefined || !Object.hasOwn(style, key)) return false;
    const group = ownObject(style, key);
    if (!GROUPS.has(key) || !isObject(value) || !group) return true;
    return Object.keys(value).some((inner) => value[inner] !== undefined && Object.hasOwn(group, inner));
  });
}

/** The stored style an ID names, as raw JSON, so keys this version does not know stay in the new style. */
function stored(sheet: Sheet, id: Json | undefined): JsonObject | undefined {
  return typeof id === 'string' ? ownObject(ownObject(sheet, 'styles'), id) : undefined;
}

/** Sets or removes the style ID of a cell. */
function setCellStyle(sheet: Sheet, row: string, col: string, style: JsonObject): void {
  const id = intern(sheet, style);
  const cells = ownObject(sheet, 'cells') ?? {};
  const byCol = ownObject(cells, row) ?? {};
  if (id === null) delete byCol[col];
  else put(byCol, col, id);
  if (Object.keys(byCol).length > 0) put(cells, row, byCol);
  else delete cells[row];
  if (Object.keys(cells).length > 0) put(sheet, 'cells', cells);
  else delete sheet.cells;
}

/** Changes the `style` of a row's, column's, or the table's settings. */
function setLineStyle(sheet: Sheet, settings: JsonObject, change: StyleChange): void {
  const id = intern(sheet, changeStyle(stored(sheet, own(settings, 'style')), change));
  if (id === null) delete settings.style;
  else put(settings, 'style', id);
}

/** The settings object of a row or column, created when missing. */
function lineSettings(sheet: Sheet, key: 'rows' | 'cols', id: string): JsonObject {
  const map = ownObject(sheet, key) ?? {};
  const settings = ownObject(map, id) ?? {};
  put(map, id, settings);
  put(sheet, key, map);
  return settings;
}

/** Removes empty settings objects of rows and columns. */
function dropEmpty(sheet: Sheet): void {
  for (const key of ['rows', 'cols']) {
    const map = ownObject(sheet, key);
    if (!map) continue;
    for (const id of Object.keys(map)) if (isObject(map[id]) && Object.keys(map[id]).length === 0) delete map[id];
    if (Object.keys(map).length === 0) delete sheet[key];
  }
  const table = ownObject(sheet, 'table');
  if (table && Object.keys(table).length === 0) delete sheet.table;
}

/** Clears the properties of `change` from the cell styles where `inside(row, col)` holds. */
function clearCells(sheet: Sheet, change: StyleChange, inside: (row: string, col: string) => boolean): void {
  const cells = ownObject(sheet, 'cells') ?? {};
  for (const row of Object.keys(cells)) {
    const byCol = ownObject(cells, row);
    if (!byCol) continue;
    for (const col of Object.keys(byCol)) {
      if (!inside(row, col)) continue;
      const style = stored(sheet, byCol[col]);
      if (style && setsAny(style, change)) setCellStyle(sheet, row, col, clearProperties(style, change));
    }
  }
}

/** Applies a change to every cell of a box, given by two corner cells. */
export function applyToRange(
  before: Sheet,
  table: TableLike,
  from: [string, string],
  to: [string, string],
  change: StyleChange,
): Applied {
  const grid = gridOf(table);
  const box: Box | null = boxOf(grid, from, to);
  return run(before, table, (sheet) => {
    if (!box) return;
    for (let r = box.top; r <= box.bottom; r++) {
      for (let c = box.left; c <= box.right; c++) {
        const row = grid.rows[r];
        const col = grid.cols[c];
        const id = own(ownObject(ownObject(sheet, 'cells'), row), col);
        setCellStyle(sheet, row, col, changeStyle(stored(sheet, id), change));
      }
    }
  });
}

/** Applies a change to whole rows: their row styles change, and the cells inside lose the same properties. */
export function applyToRows(before: Sheet, table: TableLike, rows: readonly string[], change: StyleChange): Applied {
  const known = new Set(gridOf(table).rows);
  const chosen = new Set(rows.filter((r) => known.has(r)));
  return run(before, table, (sheet) => {
    for (const row of chosen) setLineStyle(sheet, lineSettings(sheet, 'rows', row), change);
    clearCells(sheet, change, (row) => chosen.has(row));
  });
}

/**
 * Applies a change to whole columns: their column styles change, and the cells inside lose the same properties.
 * Where a row style sets one of them, the cell gets the new value, so the column applied last wins there too.
 */
export function applyToColumns(before: Sheet, table: TableLike, cols: readonly string[], change: StyleChange): Applied {
  const grid = gridOf(table);
  const known = new Set(grid.cols);
  const chosen = new Set(cols.filter((c) => known.has(c)));
  return run(before, table, (sheet) => {
    for (const col of chosen) setLineStyle(sheet, lineSettings(sheet, 'cols', col), change);
    clearCells(sheet, change, (_row, col) => chosen.has(col));
    const rows = ownObject(sheet, 'rows') ?? {};
    for (const row of grid.rows) {
      const rowStyle = stored(sheet, own(ownObject(rows, row), 'style'));
      if (!setsAny(rowStyle, change)) continue;
      for (const col of chosen) {
        const id = own(ownObject(ownObject(sheet, 'cells'), row), col);
        setCellStyle(sheet, row, col, changeStyle(stored(sheet, id), change));
      }
    }
  });
}

/** Applies a change to the table's own style, and clears the same properties from columns, rows, and cells. */
export function applyToTable(before: Sheet, table: TableLike, change: StyleChange): Applied {
  return run(before, table, (sheet) => {
    const settings = ownObject(sheet, 'table') ?? {};
    put(sheet, 'table', settings);
    setLineStyle(sheet, settings, change);
    for (const key of ['rows', 'cols'] as const) {
      const map = ownObject(sheet, key) ?? {};
      for (const id of Object.keys(map)) {
        const line = ownObject(map, id);
        const style = stored(sheet, own(line, 'style'));
        if (line && style && setsAny(style, change)) {
          const next = intern(sheet, clearProperties(style, change));
          if (next === null) delete line.style;
          else put(line, 'style', next);
        }
      }
    }
    clearCells(sheet, change, () => true);
  });
}
