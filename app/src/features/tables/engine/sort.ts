// Multi-column sorting. Order follows Excel: numbers, then text, then booleans, then errors, then blanks. Blanks
// stay last in both directions, ties keep their order, and text compares numerically ("Item 2" before "Item 10").

import { choiceRank } from './choice';
import type { Locale } from './locale';
import type { Table } from './model';
import { isError, type Value } from './values';

/** What a sort level orders by. A color or icon level puts the cells that have the chosen one first. */
export type SortBy = 'value' | 'fill' | 'fontColor' | 'icon';

export interface SortKey {
  /** A column index. */
  column: number;
  desc?: boolean;
  /** What to order by. Unset means the cell's value. */
  by?: SortBy;
  /** For a color or icon level: the color (or icon name) that goes first, or last when `desc` is set. */
  color?: string;
  /**
   * Orders text by this list, in this order, before any text not on it. Matching ignores case unless `caseSensitive`
   * is set. Descending reverses the listed items, but text not on the list still comes after them.
   */
  customList?: readonly string[];
  /** Capital letters sort before lowercase ones of the same letters. */
  caseSensitive?: boolean;
}

/** The fill color, font color, or icon of a cell, as the sheet's style layers resolve it. Unset means none. */
export type LookOf = (row: number, column: number, kind: 'fill' | 'fontColor' | 'icon') => string | undefined;

const BLANK = 4;
const collators = new Map<string, Intl.Collator>();

function collator(tag: string, caseSensitive = false): Intl.Collator {
  const id = caseSensitive ? `${tag}#case` : tag;
  let c = collators.get(id);
  if (!c) {
    // Variant sensitivity compares the letters first, then the case: "a" before "A" before "b".
    c = new Intl.Collator(tag, { numeric: true, sensitivity: caseSensitive ? 'variant' : 'base', caseFirst: 'lower' });
    collators.set(id, c);
  }
  return c;
}

/** The weekday and month names of a locale, in calendar order: the built-in custom lists. */
export function builtInLists(tag: string): { weekdays: string[][]; months: string[][] } {
  const names = (options: Intl.DateTimeFormatOptions, count: number, at: (i: number) => Date): string[] =>
    Array.from({ length: count }, (_, i) =>
      new Intl.DateTimeFormat(tag, { ...options, timeZone: 'UTC' }).format(at(i)),
    );
  // 2023-01-01 was a Sunday, so a week from there runs Sunday to Saturday.
  const day = (i: number): Date => new Date(Date.UTC(2023, 0, 1 + i));
  const month = (i: number): Date => new Date(Date.UTC(2023, i, 1));
  return {
    weekdays: [names({ weekday: 'long' }, 7, day), names({ weekday: 'short' }, 7, day)],
    months: [names({ month: 'long' }, 12, month), names({ month: 'short' }, 12, month)],
  };
}

function listed(v: unknown): number | undefined {
  return typeof v === 'object' && v !== null && 'listed' in v ? (v as { listed: number }).listed : undefined;
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
  lookOf?: LookOf,
): number[] {
  const indices = among ? [...among] : table.rows.map((_, i) => i);
  const active = keys.filter((k) => table.columns[k.column]);
  if (active.length === 0) return indices;
  const texts = active.map((k) => collator(locale.tag, k.caseSensitive));
  const columns = active.map((k) => {
    const column = table.columns[k.column];
    const options = column.options ?? [];
    if (k.by && k.by !== 'value') {
      // A color level: 0 for the cells that have the chosen color, 1 for the rest. Blanks need no special place.
      const want = (k.color ?? '').toLowerCase();
      return table.rows.map((_, r) => ((lookOf?.(r, k.column, k.by as 'fill') ?? '').toLowerCase() === want ? 0 : 1));
    }
    const fold = (text: string): string => (k.caseSensitive ? text : text.toLowerCase());
    const list = k.customList?.map((name) => fold(name));
    return table.rows.map((row) => {
      const v = row.cells[k.column].value;
      // A custom list puts the names it has first, in its order, then the other values by the usual rules.
      if (list && typeof v === 'string') {
        const at = list.indexOf(fold(v.trim()));
        if (at >= 0) return { listed: at };
      }
      // A choice sorts by the order of its options, the way the person set them, not by its letters.
      if (column.type === 'choice') return typeof v === 'string' ? choiceRank(options, v) : v;
      return column.type === 'checkbox' && v === null ? false : v;
    });
  });
  return indices.sort((i, j) => {
    for (let k = 0; k < active.length; k++) {
      const [a, b] = [columns[k][i] as Value, columns[k][j] as Value];
      const [la, lb] = [listed(columns[k][i]), listed(columns[k][j])];
      if (la !== undefined || lb !== undefined) {
        if (la !== undefined && lb !== undefined) {
          if (la !== lb) return active[k].desc ? lb - la : la - lb;
          continue;
        }
        return la !== undefined ? -1 : 1;
      }
      if (active[k].by && active[k].by !== 'value') {
        const order = (a as number) - (b as number);
        if (order !== 0) return active[k].desc ? -order : order;
        continue;
      }
      const [ra, rb] = [rank(a), rank(b)];
      if (ra === BLANK || rb === BLANK) {
        if (ra !== rb) return ra === BLANK ? 1 : -1;
        continue;
      }
      const order = ra !== rb ? ra - rb : within(a, b, texts[k]);
      if (order !== 0) return active[k].desc ? -order : order;
    }
    return 0;
  });
}

/** The table with its rows stored in sorted order. */
export function sortTable(table: Table, keys: readonly SortKey[], locale: Locale, lookOf?: LookOf): Table {
  const rows = sortedIndices(table, keys, locale, undefined, lookOf).map((i) => table.rows[i]);
  return { ...table, rows };
}
