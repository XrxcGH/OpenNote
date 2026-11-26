// Reading and writing `data.sheet` (format spec 6.3, ADR 0056). The reader is tolerant. It keeps every key and
// value, including unknown keys and invalid values, so a sheet from a later version comes back as it was (R-SHT-4).
// Accessors read invalid values as missing. The writer puts keys in code point order at every level (R-JSON-1). It
// drops entries for rows and columns the table no longer has (R-SHT-2).

import { clone, diffPatch, isObject, ordered, ownObject, type JsonObject } from './json';
import { repairMerges } from './merges';
import { repairRanges } from './rules';
import { gc } from './styles';
import type { Sheet, TableLike } from './types';

/** The sheet of a table block's data: a copy of `data.sheet`, or an empty sheet when it is missing or not an object. */
export function readSheet(data: unknown): Sheet {
  const sheet = isObject(data) ? (data as JsonObject).sheet : undefined;
  return isObject(sheet) ? clone(sheet) : {};
}

/** `data.sheet` as a writer gives it: keys in code point order at every level, or null for an empty sheet. */
export function writeSheet(sheet: Sheet): Sheet | null {
  return Object.keys(sheet).length === 0 ? null : (ordered(sheet) as Sheet);
}

/** The maps keyed by row ID, then column ID. */
const BY_CELL = ['cells', 'notes', 'values'] as const;

/** An entry that names a row or column the table no longer has: a whole row or column map, or one cell of a row. */
interface Orphan {
  key: string;
  id: string;
  col?: string;
}

/** The orphan entries as structured paths, so an ID that holds a dot never splits into the wrong keys. */
function orphanEntries(sheet: Sheet, table: TableLike): Orphan[] {
  const rows = new Set(table.rows.map((r) => r.id));
  const cols = new Set(table.columns.map((c) => c.id));
  const found: Orphan[] = Object.keys(ownObject(sheet, 'cols') ?? {})
    .filter((c) => !cols.has(c))
    .map((c) => ({ key: 'cols', id: c }));
  found.push(
    ...Object.keys(ownObject(sheet, 'rows') ?? {})
      .filter((r) => !rows.has(r))
      .map((r) => ({ key: 'rows', id: r })),
  );
  for (const key of BY_CELL) {
    const map = ownObject(sheet, key) ?? {};
    for (const row of Object.keys(map)) {
      const byCol = map[row];
      if (!rows.has(row)) found.push({ key, id: row });
      else if (isObject(byCol))
        found.push(
          ...Object.keys(byCol)
            .filter((c) => !cols.has(c))
            .map((c) => ({ key, id: row, col: c })),
        );
    }
  }
  return found;
}

/**
 * Entries that name a row or column the table no longer has (R-SHT-2), as paths: `cols.<id>`, `rows.<id>`, and
 * `cells.<row>` or `cells.<row>.<col>` (and the same for notes and values).
 */
export function orphans(sheet: Sheet, table: TableLike): string[] {
  return orphanEntries(sheet, table).map((o) =>
    o.col === undefined ? `${o.key}.${o.id}` : `${o.key}.${o.id}.${o.col}`,
  );
}

/** Drops the entries of `orphans`, and maps left empty. Changes `sheet` in place. */
export function dropOrphans(sheet: Sheet, table: TableLike): void {
  for (const { key, id, col } of orphanEntries(sheet, table)) {
    const map = ownObject(sheet, key);
    if (!map) continue;
    if (col === undefined) delete map[id];
    else {
      const byCol = ownObject(map, id);
      if (byCol) delete byCol[col];
      if (byCol && Object.keys(byCol).length === 0) delete map[id];
    }
  }
  for (const key of ['cols', 'rows', ...BY_CELL]) {
    const map = ownObject(sheet, key);
    if (map && Object.keys(map).length === 0) delete sheet[key];
  }
}

/**
 * What a writer does before each save of the block, inside the same patch: after a structure change from `before`,
 * moves merge and range corners. Then it drops what names a missing row or column, merges of one cell, and merges
 * that overlap a lower ID (writers never write overlaps), and removes unused styles. Changes `sheet` in place.
 */
export function tidy(sheet: Sheet, table: TableLike, before: TableLike = table): void {
  repairMerges(sheet, before, table);
  repairRanges(sheet, before, table);
  dropOrphans(sheet, table);
  gc(sheet);
}

/**
 * The RFC 7396 merge patch of a table block's data that turns `before` into `after`: `{sheet: {...}}` with only the
 * changed entries, `{sheet: null}` when the sheet became empty, or null when nothing changed.
 */
export function sheetPatch(before: Sheet, after: Sheet): JsonObject | null {
  const written = writeSheet(after);
  if (written === null) return Object.keys(before).length === 0 ? null : { sheet: null };
  if (Object.keys(before).length === 0) return { sheet: written };
  const diff = diffPatch(before, written);
  return diff ? { sheet: ordered(diff) } : null;
}
