// The data behind a filter menu: the values of a column with how many rows have each, and the colors in use.

import { toCanonical } from '../engine/canonical';
import type { Table } from '../engine/model';
import type { LookOf } from '../engine/sort';

export interface ValueCount {
  /** The canonical text a filter condition's "in" list uses. */
  value: string;
  count: number;
}

/** The distinct values of a column in first-seen order, each with the number of rows that hold it. Blank is "". */
export function valueCounts(table: Table, column: number): ValueCount[] {
  const type = table.columns[column]?.type;
  if (!type) return [];
  const counts = new Map<string, number>();
  for (const row of table.rows) {
    const text = toCanonical(type, row.cells[column].value);
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return [...counts].map(([value, count]) => ({ value, count }));
}

/** The distinct fill colors, font colors, or icons in a column, with counts. Cells without one are not listed. */
export function lookCounts(
  table: Table,
  column: number,
  kind: 'fill' | 'fontColor' | 'icon',
  look: LookOf,
): ValueCount[] {
  const counts = new Map<string, number>();
  table.rows.forEach((_, r) => {
    const found = look(r, column, kind);
    if (found) counts.set(found, (counts.get(found) ?? 0) + 1);
  });
  return [...counts].map(([value, count]) => ({ value, count }));
}
