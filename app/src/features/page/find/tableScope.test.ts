import { describe, expect, it } from 'vitest';
import { createTable, EN_US } from '../../tables';
import { replaceInTable, searchTable } from './tableScope';

describe('find in a table', () => {
  const t = createTable(
    [{ name: 'A' }, { name: 'B' }],
    [
      ['=SUM(1,2)', 'SUM'],
      ['3', 'sum total'],
    ],
    EN_US,
  );
  it('finds =SUM in formulas but not the text SUM', () => {
    const hits = searchTable(t, 'SUM', { within: 'formulas' });
    expect(hits.map((h) => [h.row, h.column])).toEqual([[0, 0]]);
    expect(searchTable(t, '=SUM', { within: 'formulas' })).toHaveLength(1);
  });
  it('searches values, whole cells, case, and order', () => {
    expect(searchTable(t, 'sum', { within: 'values' }).map((h) => [h.row, h.column])).toEqual([
      [0, 1],
      [1, 1],
    ]);
    expect(searchTable(t, 'sum', { within: 'values', entireCell: true }).map((h) => [h.row, h.column])).toEqual([
      [0, 1],
    ]);
    expect(searchTable(t, 'SUM', { within: 'values', caseSensitive: true }).map((h) => [h.row, h.column])).toEqual([
      [0, 1],
    ]);
    expect(searchTable(t, '3', { within: 'values', order: 'columns' }).map((h) => [h.row, h.column])).toEqual([
      [0, 0],
      [1, 0],
    ]);
  });
});

describe('replaceInTable', () => {
  it('replaces through typed input and recalculates formulas', () => {
    const t = createTable(
      [
        { name: 'A', type: 'number' },
        { name: 'B', type: 'number' },
      ],
      [
        ['1', '=A1*2'],
        ['2', '=A2*2'],
      ],
      EN_US,
    );
    const out = replaceInTable(t, '1', '5', { within: 'values', entireCell: true }, EN_US);
    expect(out.replaced).toBe(1);
    expect(out.table.rows[0].cells[0].value).toBe(5);
    expect(out.table.rows[0].cells[1].value).toBe(10);
  });
  it('replaces inside formulas when looking in formulas', () => {
    const t = createTable(
      [
        { name: 'A', type: 'number' },
        { name: 'B', type: 'number' },
      ],
      [['3', '=A1+1']],
      EN_US,
    );
    const out = replaceInTable(t, '+1', '+10', { within: 'formulas' }, EN_US);
    expect(out.table.rows[0].cells[1].value).toBe(13);
  });
});
