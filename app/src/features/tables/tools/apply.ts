// Table-level applies of the data tools. Each takes a table and returns the next table in one step. The host stores
// one undo entry per call and reports what changed.

import { adjustTable } from '../engine/refactor';
import { makeCell } from '../engine/edit';
import { formatValue } from '../engine/format';
import { EN_US, type Locale } from '../engine/locale';
import type { Cell, Column, Row, Table } from '../engine/model';
import { recalculate, type EngineEnv } from '../engine/recalc';
import type { LookOf } from '../engine/sort';
import { resolve, type CellStyle, type Fill, type ResolveHooks, type Sheet, type TableLike } from '../sheet/model';
import { styleView } from '../sheet/render/draw';
import { splitText, splitWidth, type Split } from './textToColumns';

export interface TextToColumnsResult {
  table: Table;
  /** How many columns were inserted to the right of the source column. */
  added: number;
  /** How many cells were split. */
  split: number;
  /** Set when nothing was done: the source column is calculated or missing. */
  refused?: 'calculated' | 'missing' | 'tooMany';
  /** With 'tooMany': how many columns the split would add. */
  needed?: number;
}

/** The most columns one split may add. A bigger split is refused, so a stray delimiter can't build a huge table. */
export const MAX_SPLIT_COLUMNS = 256;

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
  if (extra > MAX_SPLIT_COLUMNS) return { table, added: 0, split: 0, refused: 'tooMany', needed: extra };
  const split = parts.filter((p) => p.length > 1).length;
  if (extra === 0) return { table, added: 0, split };
  const shifted = adjustTable(table, { kind: 'insertCols', at: col + 1, count: extra });
  const ids = new Set(shifted.columns.map((c) => c.id));
  const taken = new Set(shifted.columns.map((c) => c.name.toLowerCase()));
  let part = 2;
  let next = shifted.columns.length;
  const fresh: Column[] = Array.from({ length: extra }, () => {
    // The first free id and the first free name, so structured references stay unambiguous.
    while (ids.has(`c${next}`)) next++;
    ids.add(`c${next}`);
    while (taken.has(`${source.name} ${part}`.toLowerCase())) part++;
    const name = `${source.name} ${part++}`;
    taken.add(name.toLowerCase());
    return { id: `c${next}`, type: 'text', name };
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

export interface LookOptions extends ResolveHooks {
  /** True when the table's first row is a header, as the grid draws it. */
  header?: boolean;
  /** Rows hidden by a filter. The grid takes them out of banding, so the look does too. */
  hiddenRows?: ReadonlySet<string>;
  locale?: Locale;
}

/**
 * A LookOf for sort and filter by color, built from the sheet's style layers: table look, column, row, cell, and
 * conditional formats. It resolves them as the grid does. That means the visible rows and columns only, the real
 * header flag, and the text each cell shows, so a value-based conditional fill matches. The icon kind is not a style
 * property, so it reports none. A hidden row has no look.
 */
export function sheetLookOf(sheet: Sheet, table: Table, options: LookOptions = {}): LookOf {
  const { header, hiddenRows, locale, ...hooks } = options;
  const lang = locale ?? EN_US;
  const like: TableLike = {
    header,
    columns: table.columns.map((c) => ({ id: c.id })),
    rows: table.rows.map((r) => ({
      id: r.id,
      cells: Object.fromEntries(table.columns.map((c, k) => [c.id, { markdown: shown(r.cells[k], c, lang) }] as const)),
    })),
  };
  const { view, rowHidden, colHidden } = styleView(sheet, like, hiddenRows);
  return (row, column, kind) => {
    const r = table.rows[row];
    const c = table.columns[column];
    if (!r || !c || kind === 'icon' || rowHidden[row] || colHidden[column]) return undefined;
    const style: CellStyle = resolve(sheet, view, r.id, c.id, hooks).style;
    return kind === 'fill' ? colorOf(style.fill) : style.font?.color;
  };
}
