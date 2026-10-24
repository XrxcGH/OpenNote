// Number columns with a unit (Engineering tools): cells typed in another unit of the same kind convert, totals add
// like with like, and the column writes its values in plain, engineering, or SI-prefixed form.
import { describe, expect, it } from 'vitest';
import { createTable } from './edit';
import { formatValue } from './format';
import { DE_DE, EN_US } from './locale';
import { isMismatch } from './model';
import { columnTotal } from './totals';

const loads = (notation?: 'engineering' | 'si') =>
  createTable(
    [{ name: 'Load', type: 'number', unit: 'kN', total: 'sum', ...(notation ? { notation } : {}) }],
    [['1 kN'], ['250 N'], ['0.5'], ['2 kip'], ['3 m']],
    EN_US,
  );

describe('unit columns', () => {
  it('converts each cell to the column unit and keeps a wrong kind of unit as text', () => {
    const table = loads();
    const values = table.rows.map((row) => row.cells[0].value);
    expect(values.slice(0, 3)).toEqual([1, 0.25, 0.5]);
    expect(values[3]).toBeCloseTo(8.896443231, 9);
    expect(values[4]).toBe('3 m');
    expect(isMismatch(table.columns[0], table.rows[4].cells[0])).toBe(true);
  });

  it('sums in the column unit, so 1 kN + 250 N + 0.5 kN is 1.75 kN', () => {
    const table = loads();
    const total = columnTotal(table, 0, [0, 1, 2]);
    expect(total).toBe(1.75);
    expect(formatValue(total, table.columns[0], EN_US)).toBe('1.75 kN');
  });

  it('writes values in engineering notation or with SI prefixes', () => {
    const column = loads('engineering').columns[0];
    expect(formatValue(12500, column, EN_US)).toBe('12.5×10³ kN');
    const si = loads('si').columns[0];
    expect(formatValue(12500, si, EN_US)).toBe('12.5 MN');
    expect(formatValue(0.25, si, EN_US)).toBe('250 N');
    expect(formatValue(1234.5, loads().columns[0], EN_US)).toBe('1,234.5 kN');
  });

  it('reads the decimal mark of the region', () => {
    const table = createTable([{ name: 'Länge', type: 'number', unit: 'mm' }], [['2,5 cm']], DE_DE);
    expect(table.rows[0].cells[0].value).toBe(25);
  });
});
