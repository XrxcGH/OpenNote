// The totals row. It follows the filter: pass the row indices the table shows.

import type { Table } from './model';
import { err, finish, isError, isNumber, round15, type Value } from './values';

/** One column's total over the given rows, or null when the column has no total or nothing to total. */
export function columnTotal(table: Table, col: number, rows: readonly number[]): Value {
  const kind = table.columns[col]?.total;
  if (!kind) return null;
  const values = rows.map((r) => table.rows[r].cells[col].value);
  if (kind === 'count') return values.filter((v) => v !== null && v !== '').length;
  if (kind === 'checked') return values.filter((v) => v === true).length;
  const failed = values.find(isError);
  if (failed) return failed;
  const nums = values.filter(isNumber);
  if (nums.length === 0) return null;
  switch (kind) {
    case 'sum':
      return finish(nums.reduce((a, b) => a + b, 0));
    case 'average':
      return round15(nums.reduce((a, b) => a + b, 0) / nums.length);
    case 'min':
      return Math.min(...nums);
    case 'max':
      return Math.max(...nums);
    default:
      return err('VALUE');
  }
}

/** The totals row: one value per column, null where a column has no total. */
export function totalsRow(table: Table, rows: readonly number[]): Value[] {
  return table.columns.map((_, col) => columnTotal(table, col, rows));
}

/** True when any column has a total, so the grid shows the totals row. */
export function hasTotals(table: Table): boolean {
  return table.columns.some((c) => c.total !== undefined);
}
