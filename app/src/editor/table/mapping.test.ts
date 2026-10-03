// The table mapping (PLAN.md section 10.5): data and documents round trip, the ID normalizer makes any data safe,
// and after random table commands every row still has the first row's columns, in order.
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyTableOp } from '../commands/tables';
import type { TableOp } from '../commands/tables';
import { createMarkdownCache } from '../markdown';
import type { TableData } from '../schema/specs';
import {
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  docToTableData,
  headerNames,
  newTableData,
  normalizeTableData,
  sameTableData,
  tableDataToDoc,
  tableOf,
} from './mapping';

const cache = createMarkdownCache();

const WORDS = ['alpha', 'Beta', 'x', '42', 'Stage', 'Where it happens', '**bold**', '*it*', '`code`', ''];
const word = fc.constantFrom(...WORDS);
const id = fc.stringMatching(/^[0-9a-z]{6}$/);

/** Normal table data with canonical cell Markdown, so it round trips exactly. */
const tableData: fc.Arbitrary<TableData> = fc
  .record({
    header: fc.boolean(),
    columns: fc.uniqueArray(fc.record({ id, width: fc.integer({ min: MIN_COLUMN_WIDTH, max: MAX_COLUMN_WIDTH }) }), {
      minLength: 1,
      maxLength: 6,
      selector: (column) => column.id,
    }),
    rowIds: fc.uniqueArray(
      id.map((text) => `r${text}`),
      { minLength: 1, maxLength: 8 },
    ),
    words: fc.array(word, { minLength: 48, maxLength: 48 }),
  })
  .map(({ header, columns, rowIds, words }) => ({
    header,
    columns,
    rows: rowIds.map((rowId, r) => ({
      id: rowId,
      cells: Object.fromEntries(columns.map((column, c) => [column.id, { markdown: words[(r * 6 + c) % 48] }])),
    })),
  }));

const op: fc.Arbitrary<TableOp> = fc.oneof(
  fc.constantFrom<TableOp>(
    { op: 'rowAbove' },
    { op: 'rowBelow' },
    { op: 'columnLeft' },
    { op: 'columnRight' },
    { op: 'deleteRow' },
    { op: 'deleteColumn' },
    { op: 'headerRow' },
    { op: 'moveRowUp' },
    { op: 'moveRowDown' },
  ),
  fc.integer({ min: 0, max: 3000 }).map((width): TableOp => ({ op: 'columnWidth', width })),
);

const ids = (data: TableData) => [...data.columns.map((c) => c.id), ...data.rows.map((r) => r.id)];

describe('the table mapping', () => {
  it('round trips data through the document', () => {
    fc.assert(
      fc.property(tableData, (data) => {
        const back = docToTableData(tableDataToDoc(data), data, cache);
        expect(back).toEqual(data);
      }),
    );
  });

  it('builds one row per data row, each with a cell per column, and a header row only when asked', () => {
    fc.assert(
      fc.property(tableData, (data) => {
        const table = tableOf(tableDataToDoc(data))!;
        expect(table.childCount).toBe(data.rows.length);
        table.forEach((row, _offset, r) => {
          expect(row.childCount).toBe(data.columns.length);
          row.forEach((cell, _at, c) => {
            expect(cell.type.name).toBe(data.header && r === 0 ? 'tableHeader' : 'tableCell');
            expect(cell.attrs.colwidth).toEqual([data.columns[c].width]);
          });
        });
      }),
    );
  });

  it('settles any cell text after one trip', () => {
    fc.assert(
      fc.property(tableData, fc.array(fc.string(), { minLength: 1, maxLength: 6 }), (data, texts) => {
        const messy = {
          ...data,
          rows: data.rows.map((row) => ({
            ...row,
            cells: Object.fromEntries(
              data.columns.map((column, c) => [column.id, { markdown: texts[c % texts.length] }]),
            ),
          })),
        };
        const once = docToTableData(tableDataToDoc(messy), messy, cache);
        expect(docToTableData(tableDataToDoc(once), once, cache)).toEqual(once);
      }),
    );
  });

  it('gives new rows and columns in the document fresh IDs and keeps the rest by position', () => {
    const data = newTableData(2, 2, true);
    const { nodes } = tableDataToDoc(data).type.schema;
    const doc = tableDataToDoc(data);
    const table = doc.firstChild!;
    const extraCell = () => nodes.tableCell.create(null, nodes.paragraph.create());
    const wider = table.content.replaceChild(1, table.child(1).copy(table.child(1).content.addToEnd(extraCell())));
    const grown = doc.copy(
      doc.content.replaceChild(0, table.copy(wider.addToEnd(nodes.tableRow.create(null, [extraCell()])))),
    );
    const next = docToTableData(grown, data, cache);
    expect(next.columns.slice(0, 2)).toEqual(data.columns);
    expect(next.rows.slice(0, 2).map((row) => row.id)).toEqual(data.rows.map((row) => row.id));
    expect(next.columns).toHaveLength(3);
    expect(next.rows).toHaveLength(3);
    expect(new Set(ids(next)).size).toBe(ids(next).length);
    expect(next.rows[2].cells[next.columns[1].id]).toEqual({ markdown: '' });
  });

  it('reads a header row from the first row’s cells', () => {
    const data = { ...newTableData(2, 2, true) };
    data.rows[0].cells[data.columns[0].id].markdown = 'Stage';
    data.rows[0].cells[data.columns[1].id].markdown = 'Where it happens';
    expect(headerNames(tableDataToDoc(data))).toEqual(['Stage', 'Where it happens']);
    expect(headerNames(tableDataToDoc({ ...data, header: false }))).toEqual([]);
  });
});

describe('the ID normalizer', () => {
  it('makes anything into a table with unique IDs and a cell for every column', () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        const data = normalizeTableData(input);
        expect(data.columns.length).toBeGreaterThan(0);
        expect(data.rows.length).toBeGreaterThan(0);
        expect(new Set(ids(data)).size).toBe(ids(data).length);
        for (const row of data.rows)
          expect(Object.keys(row.cells).sort()).toEqual(data.columns.map((c) => c.id).sort());
      }),
    );
  });

  it('leaves normal data equal', () => {
    fc.assert(
      fc.property(tableData, (data) => {
        expect(normalizeTableData(data)).toEqual(data);
      }),
    );
  });

  it('replaces duplicate and missing IDs, drops unknown cells, and clamps widths', () => {
    const data = normalizeTableData({
      header: 'yes',
      columns: [{ id: 'a', width: 1 }, { id: 'a', width: 99999 }, { width: 100 }],
      rows: [{ id: 'a', cells: { a: { markdown: 'x' }, z: { markdown: 'lost' } } }, { id: 'r' }, { id: 'r' }],
    });
    expect(data.header).toBe(false);
    expect(data.columns[0]).toEqual({ id: 'a', width: MIN_COLUMN_WIDTH });
    expect(data.columns[1].width).toBe(MAX_COLUMN_WIDTH);
    expect(new Set(ids(data)).size).toBe(6);
    expect(data.rows[0].cells.a).toEqual({ markdown: 'x' });
    expect(Object.values(data.rows[0].cells).some((cell) => cell.markdown === 'lost')).toBe(false);
  });
});

describe('the table commands on data', () => {
  it('keep every row on the first row’s columns, in order, after any sequence', () => {
    fc.assert(
      fc.property(tableData, fc.array(fc.tuple(op, fc.nat(10), fc.nat(10)), { maxLength: 25 }), (start, steps) => {
        let data = start;
        for (const [step, row, column] of steps) {
          const change = applyTableOp(data, { row, column }, step);
          if (!change) continue;
          data = change.data;
          if (change.caret) {
            expect(change.caret.row).toBeLessThan(data.rows.length);
            expect(change.caret.column).toBeLessThan(data.columns.length);
          }
        }
        const order = data.columns.map((column) => column.id);
        for (const row of data.rows) expect(Object.keys(row.cells)).toEqual(expect.arrayContaining(order));
        expect(new Set(ids(data)).size).toBe(ids(data).length);
        const table = tableOf(tableDataToDoc(data))!;
        table.forEach((row) => expect(row.childCount).toBe(order.length));
        expect(sameTableData(docToTableData(tableDataToDoc(data), data, cache), data)).toBe(true);
      }),
    );
  });

  it('keep a moved row’s ID and the header row on top', () => {
    const data = newTableData(2, 4, true);
    const moved = applyTableOp(data, { row: 2, column: 0 }, { op: 'moveRowUp' })!;
    expect(moved.data.rows.map((row) => row.id)).toEqual(
      [data.rows[0], data.rows[2], data.rows[1], data.rows[3]].map((row) => row.id),
    );
    expect(applyTableOp(data, { row: 1, column: 0 }, { op: 'moveRowUp' })).toBeNull();
    expect(applyTableOp(data, { row: 0, column: 0 }, { op: 'moveRowDown' })).toBeNull();
    expect(applyTableOp(data, { row: 0, column: 1 }, { op: 'rowAbove' })!.caret).toEqual({ row: 1, column: 1 });
  });

  it('never delete the last row or column', () => {
    const one = newTableData(1, 1, false);
    expect(applyTableOp(one, { row: 0, column: 0 }, { op: 'deleteRow' })).toBeNull();
    expect(applyTableOp(one, { row: 0, column: 0 }, { op: 'deleteColumn' })).toBeNull();
  });
});
