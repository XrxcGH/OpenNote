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

const fingerprints = new WeakMap<TableLike, string>();

/**
 * The fingerprint of a table (R-SHT-18): `fnv1a:` and the FNV-1a 64 hash, in 16 lowercase hexadecimal digits, of
 * the compact canonical JSON of `[header, column IDs, [[row ID, [Markdown per column]] per row], smart]`. Styles and
 * the rest of `data.sheet` are not part of it, so formatting never makes the cache stale. It is computed once per
 * table object, as `gridOf` reads it: callers treat a table as immutable and make a new object for each edit.
 */
export function fingerprint(table: TableLike): string {
  const known = fingerprints.get(table);
  if (known !== undefined) return known;
  const cols = table.columns.map((c) => c.id);
  const rows: Json = table.rows.map((row) => [row.id, cols.map((c) => markdownOf(row, c))]);
  const smart = (table.smart ?? null) as Json;
  const hash = fnv1a64(canonical([table.header === true, cols, rows, smart]));
  const found = `fnv1a:${hash.toString(16).padStart(16, '0')}`;
  fingerprints.set(table, found);
  return found;
}

/** True when the sheet's cached values were computed from the table as it is now. */
export function isFresh(sheet: Sheet, table: TableLike): boolean {
  const written = own(sheet, 'valuesOf');
  return typeof written === 'string' && written === fingerprint(table);
}

/**
 * A cached value as R-SHT-17 allows it, or undefined. An error token this version does not know is kept. `null` is an
 * empty result: readers accept it, but writers write an empty result as no entry, since a merge patch cannot set it.
 */
export function cachedValue(value: Json | undefined): CachedValue | undefined {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (isObject(value) && Object.keys(value).length === 1 && typeof value.e === 'string') return { e: value.e };
  return undefined;
}

/** The longest cached string (R-SHT-17), in UTF-16 code units. */
export const CACHED_STRING_LIMIT = 32_767;

/** A string cut to CACHED_STRING_LIMIT code units, never between the two halves of a surrogate pair. */
function fitString(text: string): string {
  if (text.length <= CACHED_STRING_LIMIT) return text;
  const high = text.charCodeAt(CACHED_STRING_LIMIT - 1);
  const end = high >= 0xd800 && high <= 0xdbff ? CACHED_STRING_LIMIT - 1 : CACHED_STRING_LIMIT;
  return text.slice(0, end);
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

/**
 * The cached value of one cell when the cache is fresh, else undefined. A cell with no entry in a fresh cache gives
 * null: for a formula or spilled cell that is an empty result (R-SHT-17).
 */
export function valueAt(sheet: Sheet, table: TableLike, row: string, col: string): CachedValue | undefined {
  if (!isFresh(sheet, table)) return undefined;
  const stored = own(ownObject(ownObject(sheet, 'values'), row), col);
  return stored === undefined ? null : cachedValue(stored);
}

/**
 * Writes the value cache in the same change as the edit that changed the values (R-SHT-17): replaces `values` and
 * stamps `valuesOf` with the table's fingerprint. Arrays are never cached as one value: give each spilled cell its
 * own entry. A string longer than 32,767 code units is cut to that length, the most R-SHT-17 allows, rather than
 * dropped, since a missing entry would read as an empty result. An empty result (null) is written as no entry,
 * because `null` inside a merge patch deletes. Changes `sheet` in place. A cache of only empty results keeps
 * `valuesOf` alone; no values at all removes both keys.
 */
export function writeValues(
  sheet: Sheet,
  table: TableLike,
  values: ReadonlyMap<string, ReadonlyMap<string, CachedValue>>,
): void {
  const out: JsonObject = {};
  let any = false;
  for (const [row, byCol] of values) {
    const cells: JsonObject = {};
    for (const [col, value] of byCol) {
      const valid = cachedValue(value as Json);
      if (valid === undefined) continue;
      const kept = typeof valid === 'string' ? fitString(valid) : valid;
      any = true;
      if (kept !== null) put(cells, col, kept);
    }
    if (Object.keys(cells).length > 0) put(out, row, cells);
  }
  if (Object.keys(out).length > 0) put(sheet, 'values', out);
  else delete sheet.values;
  if (any) put(sheet, 'valuesOf', fingerprint(table));
  else delete sheet.valuesOf;
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
