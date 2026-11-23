// The format painter: copies the formatting of one cell onto a box of cells and changes nothing else. "Formatting"
// is what the cell shows from its own layers (the column, the row, and the cell's style), not the look or the
// conditional formats, which belong to the table. The target cells get exactly that style, in place of their own.
import { applyToRange, layer, sheetPatch, styleById } from '../../sheet/model';
import type { Box, CellStyle, Sheet, StyleChange, TableLike } from '../../sheet/model';
import { own, ownObject } from '../../sheet/model/json';
import type { JsonObject } from '../../sheet/model/json';
import { CLEAR_ALL } from './named';

/** The style a cell's own layers give it: column, then row, then cell. */
export function directStyle(sheet: Sheet, table: TableLike, row: number, col: number): CellStyle {
  const rowId = table.rows[row].id;
  const colId = table.columns[col].id;
  const lineStyle = (key: 'cols' | 'rows', id: string) =>
    styleById(sheet, own(ownObject(ownObject(sheet, key), id), 'style')) ?? {};
  const cell = styleById(sheet, own(ownObject(ownObject(sheet, 'cells'), rowId), colId)) ?? {};
  return layer(layer(lineStyle('cols', colId), lineStyle('rows', rowId)), cell);
}

/** Copies the formatting of the cell at (row, col) onto every cell of `target`. */
export function paint(
  before: Sheet,
  table: TableLike,
  source: { row: number; col: number },
  target: Box,
): { sheet: Sheet; patch: JsonObject | null; refused?: 'styles' } {
  const style = directStyle(before, table, source.row, source.col);
  const from: [string, string] = [table.rows[target.top].id, table.columns[target.left].id];
  const to: [string, string] = [table.rows[target.bottom].id, table.columns[target.right].id];
  let sheet = before;
  for (const change of [CLEAR_ALL, style as StyleChange]) {
    const done = applyToRange(sheet, table, from, to, change);
    if (done.refused) return { sheet: before, patch: null, refused: 'styles' };
    sheet = done.sheet;
  }
  return { sheet, patch: sheetPatch(before, sheet) };
}
