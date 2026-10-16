import { describe, expect, it } from 'vitest';
import { createTable } from './edit';
import { filterIndices, viewIndices, type FilterCondition } from './filter';
import { EN_US } from './locale';
import type { Table } from './model';
import { sortedIndices, sortTable } from './sort';
import { columnTotal, hasTotals, totalsRow } from './totals';
import { err } from './values';

const ROWS = [
  ['Item 10', '5', '2026-03-01', 'yes'],
  ['item 2', '3', '2026-01-15', 'no'],
  ['Bolt', '5', '', 'yes'],
  ['', '', '2026-02-01', ''],
  ['Nut', '1', '2026-01-15', 'no'],
];

function sample(): Table {
  return createTable(
    [
      { name: 'Item' },
      { name: 'Qty', type: 'number', total: 'sum' },
      { name: 'Due', type: 'date' },
      { name: 'Done', type: 'checkbox', total: 'checked' },
    ],
    ROWS,
    EN_US,
  );
}

const names = (table: Table, order: number[]): string[] => order.map((i) => String(table.rows[i].cells[0].raw));

describe('sorting', () => {
  it('sorts numerically in text, with blanks last in both directions', () => {
    const table = sample();
    expect(names(table, sortedIndices(table, [{ column: 0 }], EN_US))).toEqual([
      'Bolt',
      'item 2',
      'Item 10',
      'Nut',
      '',
    ]);
    expect(names(table, sortedIndices(table, [{ column: 0, desc: true }], EN_US))).toEqual([
      'Nut',
      'Item 10',
      'item 2',
      'Bolt',
      '',
    ]);
  });

  it('sorts on several columns and keeps ties in their order', () => {
    const table = sample();
    const order = sortedIndices(table, [{ column: 1, desc: true }, { column: 2 }], EN_US);
    expect(order).toEqual([0, 2, 1, 4, 3]);
    expect(sortedIndices(table, [{ column: 1 }], EN_US, [2, 0])).toEqual([2, 0]);
  });

  it('puts numbers before text before booleans before errors before blanks', () => {
    const values = [null, err('DIV0'), true, 'x', 7, '', 'a', false, -1];
    const table: Table = {
      columns: [{ id: 'c', name: 'V', type: 'text' }],
      rows: values.map((value, i) => ({ id: `r${i}`, cells: [{ raw: '', value }] })),
    };
    const order = sortedIndices(table, [{ column: 0 }], EN_US);
    expect(order.map((i) => values[i])).toEqual([-1, 7, 'a', 'x', false, true, err('DIV0'), null, '']);
    const reversed = sortedIndices(table, [{ column: 0, desc: true }], EN_US);
    expect(reversed.map((i) => values[i])).toEqual([err('DIV0'), true, false, 'x', 'a', 7, -1, null, '']);
  });

  it('sorts dates and checkboxes, and ignores unknown columns', () => {
    const table = sample();
    expect(sortedIndices(table, [{ column: 2 }, { column: 0 }], EN_US)).toEqual([1, 4, 3, 0, 2]);
    expect(sortedIndices(table, [{ column: 3 }, { column: 1 }], EN_US)).toEqual([4, 1, 3, 0, 2]);
    expect(sortedIndices(table, [{ column: 9 }], EN_US)).toEqual([0, 1, 2, 3, 4]);
  });

  it('can store the sorted order', () => {
    const table = sortTable(sample(), [{ column: 1 }], EN_US);
    expect(table.rows.map((r) => r.cells[1].raw)).toEqual(['1', '3', '5', '5', '']);
  });
});

describe('filters', () => {
  const run = (...conditions: FilterCondition[]): number[] => filterIndices(sample(), conditions);

  it('matches text, equality, and membership by canonical text', () => {
    expect(run({ column: 0, op: 'contains', value: 'ITEM' })).toEqual([0, 1]);
    expect(run({ column: 1, op: 'eq', value: '5' })).toEqual([0, 2]);
    expect(run({ column: 1, op: 'ne', value: '5' })).toEqual([1, 3, 4]);
    expect(run({ column: 1, op: 'in', values: ['1', '3'] })).toEqual([1, 4]);
    expect(run({ column: 2, op: 'eq', value: '2026-01-15' })).toEqual([1, 4]);
  });

  it('compares numbers and dates, and never matches blanks', () => {
    expect(run({ column: 1, op: 'gt', value: '3' })).toEqual([0, 2]);
    expect(run({ column: 1, op: 'le', value: '3' })).toEqual([1, 4]);
    expect(run({ column: 1, op: 'between', value: '3', to: '5' })).toEqual([0, 1, 2]);
    expect(run({ column: 2, op: 'lt', value: '2026-02-01' })).toEqual([1, 4]);
    expect(run({ column: 2, op: 'ge', value: '2026-02-01' })).toEqual([0, 3]);
  });

  it('handles empty, checked, and several conditions at once', () => {
    expect(run({ column: 0, op: 'empty' })).toEqual([3]);
    expect(run({ column: 0, op: 'notEmpty' })).toEqual([0, 1, 2, 4]);
    expect(run({ column: 3, op: 'checked' })).toEqual([0, 2]);
    expect(run({ column: 3, op: 'unchecked' })).toEqual([1, 3, 4]);
    expect(run({ column: 3, op: 'checked' }, { column: 1, op: 'gt', value: '5' })).toEqual([]);
  });

  it('ignores conditions with an unknown operation or column, which shows more rows', () => {
    expect(run({ column: 9, op: 'eq', value: '1' })).toHaveLength(5);
    expect(run({ column: 1, op: 'sounds-like' as never })).toHaveLength(5);
  });
});

describe('filter edge cases', () => {
  it('never matches errors in comparisons', () => {
    const table = createTable(
      [
        { name: 'A', type: 'number' },
        { name: 'B', type: 'number', formula: '1/[A]' },
      ],
      [['1'], ['0']],
      EN_US,
    );
    expect(filterIndices(table, [{ column: 1, op: 'gt', value: '0' }])).toEqual([0]);
    expect(filterIndices(table, [{ column: 1, op: 'eq', value: '0' }])).toEqual([]);
  });

  it('filters then sorts in one view', () => {
    const view = viewIndices(
      sample(),
      { filters: [{ column: 1, op: 'ge', value: '3' }], sort: [{ column: 0 }] },
      EN_US,
    );
    expect(view).toEqual([2, 1, 0]);
  });
});

describe('totals', () => {
  it('follows the rows the view shows', () => {
    const table = sample();
    expect(hasTotals(table)).toBe(true);
    expect(totalsRow(table, [0, 1, 2, 3, 4])).toEqual([null, 14, null, 2]);
    expect(totalsRow(table, [1, 4])).toEqual([null, 4, null, 0]);
  });

  it('computes each kind, and leaves empty totals blank', () => {
    const base = sample();
    const kinds = (total: 'average' | 'count' | 'min' | 'max') => ({
      ...base,
      columns: base.columns.map((c, i) => (i === 1 ? { ...c, total } : c)),
    });
    const all = [0, 1, 2, 3, 4];
    expect([kinds('average'), kinds('count'), kinds('min'), kinds('max')].map((t) => columnTotal(t, 1, all))).toEqual([
      3.5, 4, 1, 5,
    ]);
    expect(columnTotal(kinds('min'), 1, [3])).toBeNull();
    expect(columnTotal(base, 0, all)).toBeNull();
    expect(hasTotals({ ...base, columns: base.columns.map((c) => ({ ...c, total: undefined })) })).toBe(false);
  });

  it('passes an error in the column through a sum', () => {
    const table = createTable(
      [
        { name: 'A', type: 'number' },
        { name: 'B', type: 'number', formula: '1/[A]', total: 'sum' },
      ],
      [['1'], ['0']],
      EN_US,
    );
    expect(columnTotal(table, 1, [0, 1])).toEqual(err('DIV0'));
    expect(columnTotal(table, 1, [0])).toBe(1);
  });
});
