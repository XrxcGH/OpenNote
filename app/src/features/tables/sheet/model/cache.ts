// The value cache (format spec R-SHT-17, R-SHT-18, ADR 0061): cached results of formula and spilled cells, and the
// fingerprint of the cells they were computed from. A reader that computes another fingerprint treats them as stale.

import { parseCell } from '../../../../editor/markdown';
import { canonical, fnv1a64, isObject, own, ownObject, put, type Json, type JsonObject } from './json';
import type { CachedValue, Sheet, TableLike } from './types';

/** The Markdown of a cell, or "" where the row has no cell in that column. */
function markdownOf(row: TableLike['rows'][number], col: string): string {
  const cell = Object.hasOwn(row.cells, col) ? row.cells[col] : undefined;
  return typeof cell?.markdown === 'string' ? cell.markdown : '';
}

/**
 * The fingerprint of a table (R-SHT-18): `fnv1a:` and the FNV-1a 64 hash, in 16 lowercase hexadecimal digits, of
 * the compact canonical JSON of `[header, column IDs, [[row ID, [Markdown per column]] per row], smart]`. Styles and
 * the rest of `data.sheet` are not part of it, so formatting never makes the cache stale.
 */
export function fingerprint(table: TableLike): string {
  const cols = table.columns.map((c) => c.id);
  const rows: Json = table.rows.map((row) => [row.id, cols.map((c) => markdownOf(row, c))]);
  const smart = (table.smart ?? null) as Json;
  const hash = fnv1a64(canonical([table.header === true, cols, rows, smart]));
  return `fnv1a:${hash.toString(16).padStart(16, '0')}`;
}

/** True when the sheet's cached values were computed from the table as it is now. */
export function isFresh(sheet: Sheet, table: TableLike): boolean {
  const written = own(sheet, 'valuesOf');
  return typeof written === 'string' && written === fingerprint(table);
}

/** A cached value as R-SHT-17 allows it, or undefined. An error token this version does not know is kept. */
export function cachedValue(value: Json | undefined): CachedValue | undefined {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (isObject(value) && Object.keys(value).length === 1 && typeof value.e === 'string') return { e: value.e };
  return undefined;
}

export interface CachedValues {
  /** The cached values by row ID, then column ID. */
  values: Map<string, Map<string, CachedValue>>;
  /** False when the cells changed since the values were written: use them as a hint only, never as results. */
  fresh: boolean;
}

/** Reads the value cache of the rows and columns the table still has. */
export function readValues(sheet: Sheet, table: TableLike): CachedValues {
  const values = new Map<string, Map<string, CachedValue>>();
  const stored = ownObject(sheet, 'values') ?? {};
  const cols = new Set(table.columns.map((c) => c.id));
  for (const row of table.rows) {
    const byCol = ownObject(stored, row.id);
    if (!byCol) continue;
    const found = new Map<string, CachedValue>();
    for (const col of Object.keys(byCol)) {
      const value = cachedValue(byCol[col]);
      if (cols.has(col) && value !== undefined) found.set(col, value);
    }
    if (found.size > 0) values.set(row.id, found);
  }
  return { values, fresh: isFresh(sheet, table) };
}

/** The cached value of one cell when the cache is fresh, else undefined. */
export function valueAt(sheet: Sheet, table: TableLike, row: string, col: string): CachedValue | undefined {
  if (!isFresh(sheet, table)) return undefined;
  return cachedValue(own(ownObject(ownObject(sheet, 'values'), row), col));
}

/**
 * Writes the value cache in the same change as the edit that changed the values (R-SHT-17): replaces `values` and
 * stamps `valuesOf` with the table's fingerprint. Arrays are never cached as one value: give each spilled cell its
 * own entry. Changes `sheet` in place; an empty cache removes both keys.
 */
export function writeValues(
  sheet: Sheet,
  table: TableLike,
  values: ReadonlyMap<string, ReadonlyMap<string, CachedValue>>,
): void {
  const out: JsonObject = {};
  for (const [row, byCol] of values) {
    const cells: JsonObject = {};
    for (const [col, value] of byCol) {
      const kept = cachedValue(value as Json);
      if (kept !== undefined) put(cells, col, kept);
    }
    if (Object.keys(cells).length > 0) put(out, row, cells);
  }
  if (Object.keys(out).length === 0) {
    delete sheet.values;
    delete sheet.valuesOf;
    return;
  }
  put(sheet, 'values', out);
  put(sheet, 'valuesOf', fingerprint(table));
}

/** The readable text of a cell's Markdown (R-TXT-1), as the editor's Markdown reader gives it. */
export function readableText(markdown: string): string {
  return markdown
    .split('\n\n')
    .map((part) => parseCell(part).textContent)
    .join('\n\n');
}

/** The formula cells of a table (R-SHT-5): cells whose readable text starts with `=`, in table order. */
export function formulaCells(
  table: TableLike,
  textOf: (markdown: string) => string = readableText,
): [string, string][] {
  const found: [string, string][] = [];
  for (const row of table.rows) {
    for (const col of table.columns) {
      if (!Object.hasOwn(row.cells, col.id)) continue;
      const markdown = markdownOf(row, col.id);
      if (/[=&]/.test(markdown) && textOf(markdown).startsWith('=')) found.push([row.id, col.id]);
    }
  }
  return found;
}
