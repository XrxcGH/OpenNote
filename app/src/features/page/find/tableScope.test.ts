import { describe, expect, it } from 'vitest';
import { createTable, EN_US } from '../../tables';
import { searchTable } from './tableScope';

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
