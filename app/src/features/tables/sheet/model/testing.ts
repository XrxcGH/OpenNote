// Test helpers of the sheet model: the spec's data.sheet fixtures (docs/format/fixtures/table-sheet/), the lane's
// own fixtures (features/tables/fixtures/sheet/), and small tables with readable IDs.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JsonObject } from './json';
import type { TableLike } from './types';

const SPEC = fileURLToPath(new URL('../../../../../../docs/format/fixtures/table-sheet/', import.meta.url));
const OWN = fileURLToPath(new URL('../../fixtures/sheet/', import.meta.url));

export interface SpecCase {
  file: string;
  name: string;
  rules: string[];
  data: TableLike & JsonObject;
  problems?: string[];
  expect?: Record<string, unknown>;
}

function load(dir: string): { file: string; json: JsonObject }[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => ({ file, json: JSON.parse(readFileSync(join(dir, file), 'utf8')) as JsonObject }));
}

/** Every case of the spec: the table is the first block of the case's page. */
export function specCases(): SpecCase[] {
  return load(SPEC).map(({ file, json }) => {
    const page = json.page as { blocks: { data: TableLike & JsonObject }[] };
    return { file, ...(json as object), data: page.blocks[0].data } as SpecCase;
  });
}

export function specCase(file: string): SpecCase {
  const found = specCases().find((c) => c.file === file);
  if (!found) throw new Error(`No spec case ${file}`);
  return found;
}

/** The lane's own fixtures: `{name, data}` with a table block's data. */
export function ownCases(): { file: string; name: string; data: TableLike & JsonObject }[] {
  return load(OWN).map(({ file, json }) => ({ file, ...(json as { name: string; data: TableLike & JsonObject }) }));
}

/** A row ID of the fixtures' form, numbered from 1. */
export const R = (n: number) => `01m3sbcmt0000000000000r${String(n).padStart(3, '0')}`;
/** A column ID of the fixtures' form, numbered from 1. */
export const K = (n: number) => `01m3sbcmt0000000000000k${String(n).padStart(3, '0')}`;

/** A table of `rows` by `cols` with row and column IDs R(1).. and K(1).., and cells named A1, B1, and so on. */
export function makeTable(rows: number[], cols: number[], header = false): TableLike {
  return {
    header,
    columns: cols.map((c) => ({ id: K(c) })),
    rows: rows.map((r) => ({
      id: R(r),
      cells: Object.fromEntries(cols.map((c) => [K(c), { markdown: `${'ABCDEFGHIJ'[c - 1]}${r}` }])),
    })),
  };
}

export const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
