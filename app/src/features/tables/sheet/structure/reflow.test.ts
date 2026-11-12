// The table commands with the spreadsheet registered (hooks.ts): structure changes adjust the references of
// formulas, names, rules, and merges (ADR 0056, DESIGN 6.8). The expected formulas are worked out by hand from the
// rule that a reference moves with its cell and a deleted cell reads #REF!.
import { describe, expect, it } from 'vitest';
import { applyTableOp } from '../../../../editor/commands/tables';
import type { TableChange, TableOp } from '../../../../editor/commands/tables';
import type { TableData } from '../../../../editor/schema/specs';
import { EN_US } from '../../engine';
import { EMPTY_SMART } from '../../smart/data';
import { buildModel } from '../../smart/model';
import './hooks';

/** Table data from rows of text: columns k1.., rows r1.., 160 wide. */
function table(rows: string[][], header = false): TableData {
  const columns = rows[0].map((_, c) => ({ id: `k${c + 1}`, width: 160 }));
  return {
    header,
    columns,
    rows: rows.map((texts, r) => ({
      id: `r${r + 1}`,
      cells: Object.fromEntries(columns.map((c, i) => [c.id, { markdown: texts[i] ?? '' }])),
    })),
  };
}

const text = (data: TableData, r: number, c: number) => data.rows[r].cells[data.columns[c].id].markdown;

/** What the table shows in a cell: its value after the engine has run the formulas. */
function value(data: TableData, r: number, c: number): unknown {
  const model = buildModel(
    {
      header: data.header,
      columnIds: data.columns.map((x) => x.id),
      texts: data.rows.map((row) => data.columns.map((x) => row.cells[x.id].markdown)),
    },
    EMPTY_SMART,
    EN_US,
  );
  return model.table.rows[r - model.offset].cells[c].value;
}

const run = (data: TableData, row: number, column: number, op: TableOp, sheet?: unknown): TableChange => {
  const change = applyTableOp(data, { row, column }, op, sheet);
  if (!change) throw new Error('the op did not apply');
  return change;
};

const prices = () =>
  table([
    ['a', '1', '2', ''],
    ['b', '3', '4', '=B2*C2'],
    ['c', '5', '6', '=B3*C3'],
    ['d', '', '', '=SUM(B2:B3)'],
  ]);

describe('reference adjustment on row changes', () => {
  it('inserting a row above row 2 moves =B2*C2 to D3 as =B3*C3 with the same result', () => {
    const before = prices();
    const after = run(before, 1, 0, { op: 'rowAbove' }).data;
    expect(text(after, 2, 3)).toBe('=B3*C3');
    expect(value(after, 2, 3)).toBe(value(before, 1, 3));
    expect(value(after, 2, 3)).toBe(12);
  });

  it('inserts a row inside a range and the range grows', () => {
    const data = table([
      ['1', ''],
      ['2', ''],
      ['3', ''],
      ['4', '=SUM(A1:A4)'],
    ]);
    // A row below row 2 (index 1) is inserted inside A1:A4.
    expect(text(run(data, 1, 0, { op: 'rowBelow' }).data, 4, 1)).toBe('=SUM(A1:A5)');
  });

  it('deleting a row gives #REF! for a reference to it and shrinks ranges that hold it', () => {
    const data = prices();
    const after = run(data, 2, 0, { op: 'deleteRow' }).data;
    expect(after.rows).toHaveLength(3);
    expect(text(after, 2, 3)).toBe('=SUM(B2:B2)');
    // Row 3 held =B3*C3; with row 2 gone it moves up and reads =B2*C2.
    const gone = run(prices(), 1, 0, { op: 'deleteRow' }).data;
    expect(text(gone, 1, 3)).toBe('=B2*C2');
    const dead = table([
      ['1', ''],
      ['2', ''],
      ['', '=A2*2'],
    ]);
    expect(text(run(dead, 1, 0, { op: 'deleteRow' }).data, 1, 1)).toBe('=#REF!*2');
  });

  it('a moved row keeps its formulas pointing at the same cells', () => {
    const data = table([
      ['1', '=A2'],
      ['2', '=A1'],
    ]);
    const after = run(data, 1, 0, { op: 'moveRowUp' }).data;
    // The old row 2 is now row 1: its =A1 now reads the old row 1, which is row 2.
    expect(text(after, 0, 1)).toBe('=A2');
    expect(text(after, 1, 1)).toBe('=A1');
  });

  it('counts rows from the first body row when the table has a header', () => {
    const data = table(
      [
        ['Item', 'Price', 'Total'],
        ['x', '3', '=B1*2'],
        ['y', '4', '=B2*2'],
      ],
      true,
    );
    const after = run(data, 1, 0, { op: 'rowAbove' }).data;
    expect(text(after, 2, 2)).toBe('=B2*2');
    expect(text(after, 3, 2)).toBe('=B3*2');
  });
});

describe('reference adjustment on column changes', () => {
  it('inserting a column left of B moves the references right', () => {
    const data = table([['1', '2', '=A1+B1']]);
    const after = run(data, 0, 1, { op: 'columnLeft' }).data;
    expect(text(after, 0, 3)).toBe('=A1+C1');
    expect(value(after, 0, 3)).toBe(3);
  });

  it('deleting a column gives #REF! for its cells', () => {
    const data = table([['1', '2', '=B1']]);
    expect(text(run(data, 0, 1, { op: 'deleteColumn' }).data, 0, 1)).toBe('=#REF!');
  });
});

describe('names, rules, and merges follow', () => {
  const sheet = {
    names: { Tax: { ref: 'B2:B3' }, Rate: { ref: '0.2' } },
    conditional: {
      c1: { order: 1, ranges: [{ col: 'k2' }], type: 'formula', a: '=B2>C2' },
    },
    validation: { v1: { ranges: [{ col: 'k2' }], kind: 'custom', a: '=B3>0' } },
    merges: { m1: { from: ['r2', 'k1'], to: ['r3', 'k1'] } },
  };

  it('rewrites name and rule formulas and keeps merge corners by ID', () => {
    const change = run(prices(), 1, 0, { op: 'rowAbove' }, sheet);
    const patch = (change.extra as { sheet: Record<string, Record<string, Record<string, unknown>>> }).sheet;
    expect(patch.names.Tax.ref).toBe('B3:B4');
    expect(patch.conditional.c1.a).toBe('=B3>C3');
    expect(patch.validation.v1.a).toBe('=B4>0');
    // The merge names its corner rows by ID, so it needs no change when a row is inserted.
    expect(patch.merges).toBeUndefined();
  });

  it('moves a merge corner inward when its row is deleted, and drops what has no cell left', () => {
    const change = run(prices(), 1, 0, { op: 'deleteRow' }, sheet);
    const next = (change.extra as { sheet: Record<string, Record<string, Record<string, unknown>>> }).sheet;
    expect(next.merges).toBeNull();
  });

  it('adds nothing for a table without a sheet', () => {
    expect(run(prices(), 1, 0, { op: 'rowAbove' }).extra).toBeUndefined();
  });
});
