// Whether a table's shape changed, as the table sync asks on each transaction (textSync.ts sameShape).
import { describe, expect, it } from 'vitest';
import type { TableData } from '../../../editor/schema/specs';
import { sameShape } from './textSync';

function table(rows: number): TableData {
  return {
    header: true,
    columns: [{ id: 'a' }, { id: 'b' }] as TableData['columns'],
    rows: Array.from({ length: rows }, (_, r) => ({
      id: `r${r}`,
      cells: { a: { markdown: `a${r}` }, b: { markdown: `b${r}` } },
    })) as TableData['rows'],
  };
}

describe('sameShape', () => {
  it('is true when only a cell text changed', () => {
    const before = table(3);
    const rows = before.rows.slice();
    rows[1] = { ...rows[1], cells: { ...rows[1].cells, a: { markdown: 'typed' } } };
    expect(sameShape(before, { ...before, rows })).toBe(true);
  });

  it('is false for a new row, a moved row, a new cell, a new column, or the header', () => {
    const before = table(3);
    expect(sameShape(before, table(4))).toBe(false);
    expect(sameShape(before, { ...before, rows: [before.rows[1], before.rows[0], before.rows[2]] })).toBe(false);
    const rows = before.rows.slice();
    rows[2] = { ...rows[2], cells: { ...rows[2].cells, c: { markdown: '' } } };
    expect(sameShape(before, { ...before, rows })).toBe(false);
    const columns = [...before.columns, { id: 'c' }] as TableData['columns'];
    expect(sameShape(before, { ...before, columns })).toBe(false);
    expect(sameShape(before, { ...before, header: false })).toBe(false);
  });

  it('is false when the cells come in another order, as the text of the shape would differ', () => {
    const before = table(2);
    const rows = before.rows.slice();
    rows[0] = { ...rows[0], cells: { b: rows[0].cells.b, a: rows[0].cells.a } };
    expect(sameShape(before, { ...before, rows })).toBe(false);
  });

  it('compares rows that a key left alone by reference, without reading their cells', () => {
    const before = table(2);
    const guarded = { ...before.rows[1] };
    Object.defineProperty(guarded, 'cells', {
      get: () => {
        throw new Error('read');
      },
    });
    const rows = [before.rows[0], guarded];
    expect(sameShape({ ...before, rows }, { ...before, rows: rows.slice() })).toBe(true);
  });
});
