// Row tools: remove duplicates and trim spaces. Both return a new table and a count, so the caller can say what changed
// and apply the result as one undo step.

import { deleteRows, makeCell } from '../engine/edit';
import { formatValue } from '../engine/format';
import { EN_US, type Locale } from '../engine/locale';
import type { Cell, Column, Table } from '../engine/model';
import { recalculate, type EngineEnv } from '../engine/recalc';

export interface DuplicatesResult {
  table: Table;
  removed: number;
  kept: number;
  /** The ids of the removed rows, so the caller can drop their formats and hidden marks. */
  removedIds: string[];
}

/**
 * The text a duplicate check compares: what the cell shows, formatted as its column shows it, without the spaces
 * around it. A formula cell compares by its result, never by its formula text. A cell with no value compares as typed.
 */
const keyText = (cell: Cell, column: Column, locale: Locale): string =>
  (cell.value === null ? cell.raw : formatValue(cell.value, column, locale)).trim();

/**
 * Removes the rows that repeat an earlier row in every one of `columns` (all columns when none are given). The first
 * of each group stays. Blank cells match blank cells, as in Excel.
 */
export function removeDuplicates(
  table: Table,
  columns: readonly number[] = table.columns.map((_, i) => i),
  options: { caseSensitive?: boolean; locale?: Locale; env?: EngineEnv } = {},
): DuplicatesResult {
  const caseSensitive = options.caseSensitive ?? false;
  const locale = options.locale ?? EN_US;
  const picked = columns.filter((c) => table.columns[c]);
  const seen = new Set<string>();
  const kept: number[] = [];
  const removedIds: string[] = [];
  table.rows.forEach((row, i) => {
    const key = JSON.stringify(
      picked.map((c) => {
        const text = keyText(row.cells[c], table.columns[c], locale);
        return caseSensitive ? text : text.toLowerCase();
      }),
    );
    if (seen.has(key)) {
      removedIds.push(row.id);
      return;
    }
    seen.add(key);
    kept.push(i);
  });
  if (removedIds.length === 0) return { table, removed: 0, kept: table.rows.length, removedIds };
  // Delete from the bottom up through the engine, so references to the rows below shift or become #REF!.
  const gone = new Set(removedIds);
  let next = table;
  for (let i = table.rows.length - 1; i >= 0; i--) {
    if (gone.has(table.rows[i].id)) next = deleteRows(next, i, 1, options.env);
  }
  return { table: next, removed: removedIds.length, kept: next.rows.length, removedIds };
}

/**
 * Trim spaces: removes the spaces at the start and end of text cells, and turns each run of spaces inside a cell into
 * one space, as Excel's TRIM does. Returns the table and how many cells changed.
 */
export function trimSpaces(
  table: Table,
  locale: Locale,
  columns: readonly number[] = table.columns.map((_, i) => i),
): { table: Table; changed: number } {
  let changed = 0;
  const rows = table.rows.map((row) => {
    const cells: Cell[] = [...row.cells];
    let touched = false;
    for (const c of columns) {
      const column = table.columns[c];
      const cell = cells[c];
      if (
        !column ||
        !cell ||
        column.formula !== undefined ||
        cell.formula !== undefined ||
        typeof cell.value !== 'string'
      )
        continue;
      const trimmed = cell.raw.replace(/ {2,}/g, ' ').replace(/^ +| +$/g, '');
      if (trimmed === cell.raw) continue;
      changed++;
      touched = true;
      cells[c] = makeCell(column, trimmed, locale, false, table);
    }
    return touched ? { ...row, cells } : row;
  });
  return changed === 0 ? { table, changed } : { table: recalculate({ ...table, rows }), changed };
}
