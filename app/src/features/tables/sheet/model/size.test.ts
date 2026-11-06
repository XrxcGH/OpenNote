// checks-disable-file brand-consistency: cell colors here are document data of the file format, not interface styling
import { describe, expect, it } from 'vitest';
import { applyToColumns } from './apply';
import { canonical, pretty, put, type Json, type JsonObject } from './json';
import { writeSheet } from './sheet';
import { intern } from './styles';
import { K, R, range } from './testing';
import type { Sheet, TableLike } from './types';

const MiB = 1024 * 1024;

describe('the size of data.sheet (DESIGN 3.4)', () => {
  it('stores 100,000 cells with 30 distinct styles in under 3 MiB', () => {
    // 1,000 rows by 100 columns. Ten styles go on whole columns, so every cell is formatted. Twenty more go on
    // 40,000 single cells in the first 400 rows, as a person formats a report: by column, then a block by hand.
    const rows = range(1, 1000);
    const cols = range(1, 100);
    const table: TableLike = {
      columns: cols.map((c) => ({ id: K(c) })),
      rows: rows.map((r) => ({ id: R(r), cells: {} })),
    };
    let sheet: Sheet = {};
    for (let s = 0; s < 10; s++) {
      const chosen = cols.filter((c) => c % 10 === s).map(K);
      sheet = applyToColumns(sheet, table, chosen, { fill: `#0000${String(s).padStart(2, '0')}` }).sheet;
    }
    const cells: JsonObject = {};
    for (const r of rows.slice(0, 400)) {
      const byCol: JsonObject = {};
      for (const c of cols) {
        const id = intern(sheet, { font: { size: 10 + ((r + c) % 20) } });
        put(byCol, K(c), id as string);
      }
      put(cells, R(r), byCol);
    }
    sheet.cells = cells;
    const written = writeSheet(sheet) as Json;
    expect(Object.keys(sheet.styles as object)).toHaveLength(30);

    // On disk the sheet sits four levels deep in page.json (page, blocks, block, data), in the canonical form.
    const onDisk = new TextEncoder().encode(`"sheet": ${pretty(written, 4)}`).length;
    const compact = new TextEncoder().encode(canonical(written)).length;
    expect(onDisk).toBeLessThan(3 * MiB);
    expect(compact).toBeLessThan(onDisk);
    // One cell style costs its column ID, its style ID, and the punctuation: 38 bytes in compact form.
    expect(compact / 40_000).toBeLessThan(40);
  });
});
