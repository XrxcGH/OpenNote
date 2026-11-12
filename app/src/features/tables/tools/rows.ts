// Row tools: remove duplicates and trim spaces. Both return a new table and a count, so the caller can say what changed
// and apply the result as one undo step.

import { makeCell } from '../engine/edit';
import type { Locale } from '../engine/locale';
import type { Cell, Table } from '../engine/model';
import { recalculate } from '../engine/recalc';

export interface DuplicatesResult {
  table: Table;
  removed: number;
  kept: number;
  /** The ids of the removed rows, so the caller can drop their formats and hidden marks. */
  removedIds: string[];
}

/** The text a duplicate check compares: what the cell holds as typed, without the spaces around it. */
const keyText = (cell: Cell): string =>
  (cell.raw !== '' ? cell.raw : cell.value === null ? '' : String(cell.value)).trim();

/**
 * Removes the rows that repeat an earlier row in every one of `columns` (all columns when none are given). The first
 * of each group stays. Blank cells match blank cells, as in Excel.
 */
export function removeDuplicates(
  table: Table,
  columns: readonly number[] = table.columns.map((_, i) => i),
  options: { caseSensitive?: boolean } = {},
): DuplicatesResult {
  const caseSensitive = options.caseSensitive ?? false;
  const picked = columns.filter((c) => table.columns[c]);
  const seen = new Set<string>();
  const kept: number[] = [];
  const removedIds: string[] = [];
  table.rows.forEach((row, i) => {
    const key = JSON.stringify(
      picked.map((c) => (caseSensitive ? keyText(row.cells[c]) : keyText(row.cells[c]).toLowerCase())),
    );
    if (seen.has(key)) {
      removedIds.push(row.id);
      return;
    }
    seen.add(key);
    kept.push(i);
  });
  if (removedIds.length === 0) return { table, removed: 0, kept: table.rows.length, removedIds };
  const rows = kept.map((i) => table.rows[i]);
  return { table: recalculate({ ...table, rows }), removed: removedIds.length, kept: rows.length, removedIds };
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
