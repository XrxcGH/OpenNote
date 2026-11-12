// Table-level applies of the data tools. Each takes a table and returns the next table in one step. The host stores
// one undo entry per call and reports what changed.

import { adjustTable } from '../engine/refactor';
import { makeCell } from '../engine/edit';
import { formatValue } from '../engine/format';
import { EN_US, type Locale } from '../engine/locale';
import type { Cell, Column, Row, Table } from '../engine/model';
import { recalculate, type EngineEnv } from '../engine/recalc';
import type { LookOf } from '../engine/sort';
import { resolve, type CellStyle, type Fill, type ResolveHooks, type Sheet } from '../sheet/model';
import { splitText, splitWidth, type Split } from './textToColumns';

export interface TextToColumnsResult {
  table: Table;
  /** How many columns were inserted to the right of the source column. */
  added: number;
  /** How many cells were split. */
  split: number;
  /** Set when nothing was done: the source column is calculated or missing. */
  refused?: 'calculated' | 'missing';
}

const shown = (cell: Cell, column: Column, locale: Locale): string =>
  cell.value === null ? cell.raw : formatValue(cell.value, column, locale);

/**
 * Splits one column into several. The first part stays in the source column. The other parts go into new columns
 * inserted right after it, so no existing cell is overwritten and formulas that point right of the column shift.
 * A calculated column can't be split.
 */
export function applyTextToColumns(
  table: Table,
  col: number,
  rule: Split,
  locale: Locale = EN_US,
  env?: EngineEnv,
): TextToColumnsResult {
  const source = table.columns[col];
  if (!source) return { table, added: 0, split: 0, refused: 'missing' };
  if (source.formula !== undefined) return { table, added: 0, split: 0, refused: 'calculated' };
  const parts = table.rows.map((row) => splitText(shown(row.cells[col], source, locale), rule));
  const extra = Math.max(0, splitWidth(parts) - 1);
  const split = parts.filter((p) => p.length > 1).length;
  if (extra === 0) return { table, added: 0, split };
  const shifted = adjustTable(table, { kind: 'insertCols', at: col + 1, count: extra });
  const ids = new Set(shifted.columns.map((c) => c.id));
  const fresh: Column[] = Array.from({ length: extra }, (_, k) => {
    let n = shifted.columns.length + k;
    while (ids.has(`c${n}`)) n++;
    ids.add(`c${n}`);
    return { id: `c${n}`, type: 'text', name: `${source.name} ${k + 2}` };
  });
  const columns = [...shifted.columns.slice(0, col + 1), ...fresh, ...shifted.columns.slice(col + 1)];
  const rows: Row[] = shifted.rows.map((row, r) => {
    const cells = [...row.cells];
    if (parts[r].length > 1) cells[col] = makeCell(source, parts[r][0], locale, false, table);
    const added = fresh.map((column, k) => makeCell(column, parts[r][k + 1] ?? '', locale, false, table));
    cells.splice(col + 1, 0, ...added);
    return { ...row, cells };
  });
  return { table: recalculate({ ...shifted, columns, rows }, env), added: extra, split };
}

const colorOf = (fill: Fill | undefined): string | undefined => {
  if (fill === undefined || fill === 'none') return undefined;
  if (typeof fill === 'string') return fill;
  if ('gradient' in fill) return fill.gradient.stops[0]?.color;
  return fill.back ?? fill.color;
};

/**
 * A LookOf for sort and filter by color, built from the sheet's style layers (table look, column, row, cell, and
 * conditional formats) as the grid resolves them. The icon kind is not a style property, so it reports none.
 */
export function sheetLookOf(sheet: Sheet, table: Table, hooks: ResolveHooks = {}): LookOf {
  const like = {
    header: false,
    columns: table.columns.map((c) => ({ id: c.id })),
    rows: table.rows.map((r) => ({ id: r.id, cells: {} })),
  };
  return (row, column, kind) => {
    const r = table.rows[row];
    const c = table.columns[column];
    if (!r || !c || kind === 'icon') return undefined;
    const style: CellStyle = resolve(sheet, like, r.id, c.id, hooks).style;
    return kind === 'fill' ? colorOf(style.fill) : style.font?.color;
  };
}
