// Sort left to right: reorders the columns by the values in one or more rows. References follow the columns, as they
// do when the person drags a column, so no formula changes meaning.

import { adjustTable } from '../engine/refactor';
import type { Locale } from '../engine/locale';
import type { Column, Row, Table } from '../engine/model';
import { recalculate, type EngineEnv } from '../engine/recalc';
import { sortedIndices, type SortKey } from '../engine/sort';

/** A left-to-right sort level: the row whose values order the columns. The other fields are those of SortKey. */
export interface ColumnSortKey extends Omit<SortKey, 'column' | 'by' | 'color'> {
  /** A row index. */
  row: number;
}

export interface ColumnSortOptions {
  /** How many columns from the left stay where they are, such as a label column. Default 0. */
  fixed?: number;
  env?: EngineEnv;
}

/** The column indices in sorted order, the first `fixed` unmoved. */
export function sortedColumnOrder(table: Table, keys: readonly ColumnSortKey[], locale: Locale, fixed = 0): number[] {
  const live = keys.filter((k) => table.rows[k.row]);
  const all = table.columns.map((_, i) => i);
  if (live.length === 0) return all;
  const head = Math.max(0, Math.min(fixed, all.length));
  // Turn the table on its side: one row per column, one column per sort row, then sort those rows.
  const side: Table = {
    ...table,
    columns: live.map((_, k): Column => ({ id: `k${k}`, type: 'text', name: `k${k}` })),
    rows: table.columns.map((_, c): Row => ({
      id: `c${c}`,
      cells: live.map((k) => ({ ...table.rows[k.row].cells[c] })),
    })),
  };
  const sortKeys: SortKey[] = live.map(({ row: _row, ...rest }, k) => ({ ...rest, column: k }));
  return [...all.slice(0, head), ...sortedIndices(side, sortKeys, locale, all.slice(head))];
}

/**
 * Sorts the columns by the values of the given rows. Each step moves one column through the engine's column move,
 * so references in formulas, names, and rules follow. Returns the new table, or the same table when the order holds.
 */
export function sortColumnsByRows(
  table: Table,
  keys: readonly ColumnSortKey[],
  locale: Locale,
  options: ColumnSortOptions = {},
): Table {
  const order = sortedColumnOrder(table, keys, locale, options.fixed);
  let current = table.columns.map((_, i) => i);
  let next = table;
  let moved = false;
  order.forEach((want, to) => {
    const from = current.indexOf(want);
    if (from === to) return;
    moved = true;
    next = adjustTable(next, { kind: 'moveCols', from, count: 1, to });
    const place = <T>(list: readonly T[]): T[] => {
      const out = [...list];
      const [item] = out.splice(from, 1);
      out.splice(to, 0, item);
      return out;
    };
    next = { ...next, columns: place(next.columns), rows: next.rows.map((r) => ({ ...r, cells: place(r.cells) })) };
    current = place(current);
  });
  return moved ? recalculate(next, options.env) : table;
}
