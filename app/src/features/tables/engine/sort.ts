// Multi-column sorting. Order follows Excel: numbers, then text, then booleans, then errors, then blanks. Blanks
// stay last in both directions, ties keep their order, and text compares numerically ("Item 2" before "Item 10").

import type { Locale } from './locale';
import type { Table } from './model';
import { isError, type Value } from './values';

export interface SortKey {
  /** A column index. */
  column: number;
  desc?: boolean;
}

const BLANK = 4;
const collators = new Map<string, Intl.Collator>();

function collator(tag: string): Intl.Collator {
  let c = collators.get(tag);
  if (!c) {
    c = new Intl.Collator(tag, { numeric: true, sensitivity: 'base' });
    collators.set(tag, c);
  }
  return c;
}

function rank(v: Value): number {
  if (v === null || v === '') return BLANK;
  return typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : typeof v === 'boolean' ? 2 : 3;
}

function within(a: Value, b: Value, text: Intl.Collator): number {
  if (typeof a === 'number') return a - (b as number);
  if (typeof a === 'string') return text.compare(a, b as string);
  if (typeof a === 'boolean') return Number(a) - Number(b as boolean);
  return isError(a) && isError(b) ? (a.error < b.error ? -1 : a.error > b.error ? 1 : 0) : 0;
}

/** Row indices in sorted order. Pass `among` to sort only some rows, such as those a filter shows. */
export function sortedIndices(
  table: Table,
  keys: readonly SortKey[],
  locale: Locale,
  among?: readonly number[],
): number[] {
  const indices = among ? [...among] : table.rows.map((_, i) => i);
  const active = keys.filter((k) => table.columns[k.column]);
  if (active.length === 0) return indices;
  const text = collator(locale.tag);
  const columns = active.map((k) => {
    const checkbox = table.columns[k.column].type === 'checkbox';
    return table.rows.map((row) => {
      const v = row.cells[k.column].value;
      return checkbox && v === null ? false : v;
    });
  });
  return indices.sort((i, j) => {
    for (let k = 0; k < active.length; k++) {
      const [a, b] = [columns[k][i], columns[k][j]];
      const [ra, rb] = [rank(a), rank(b)];
      if (ra === BLANK || rb === BLANK) {
        if (ra !== rb) return ra === BLANK ? 1 : -1;
        continue;
      }
      const order = ra !== rb ? ra - rb : within(a, b, text);
      if (order !== 0) return active[k].desc ? -order : order;
    }
    return 0;
  });
}

/** The table with its rows stored in sorted order. */
export function sortTable(table: Table, keys: readonly SortKey[], locale: Locale): Table {
  const rows = sortedIndices(table, keys, locale).map((i) => table.rows[i]);
  return { ...table, rows };
}
