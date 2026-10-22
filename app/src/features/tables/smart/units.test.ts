// Units on smart table columns (Engineering tools): the stored settings are checked when read, a unit makes the
// column a number column, and cells show their values converted, with the totals in the column's unit.
import { describe, expect, it } from 'vitest';
import { EN_US } from '../engine';
import { EMPTY_SMART, readSmart, withColumn } from './data';
import { buildModel, shownFor } from './model';
import type { Grid } from './model';

const grid: Grid = {
  header: true,
  columnIds: ['member', 'force'],
  texts: [
    ['Member', 'Force'],
    ['AB', '12 kN'],
    ['BC', '-750 N'],
    ['CD', '2.5'],
  ],
};

describe('unit columns in smart tables', () => {
  it('keeps a known unit and notation and drops anything else', () => {
    const read = readSmart({ smart: { columns: { force: { unit: 'kN', notation: 'si' }, member: { unit: 'zz' } } } });
    expect(read.columns.force).toEqual({ unit: 'kN', notation: 'si' });
    expect(read.columns.member).toBeUndefined();
  });

  it('reads a column with a unit as numbers in that unit, and shows them converted', () => {
    const smart = withColumn(EMPTY_SMART, 'force', { unit: 'kN', total: 'sum' });
    const model = buildModel(grid, smart, EN_US);
    expect(model.table.columns[1].type).toBe('number');
    expect(model.table.rows.map((row) => row.cells[1].value)).toEqual([12, -0.75, 2.5]);
    expect(shownFor(model, smart, 1, 1, EN_US)).toEqual({ text: '-0.75 kN', kind: 'number' });
    expect(shownFor(model, smart, 0, 1, EN_US)).toBeNull();
  });

  it('writes SI prefixes when the column asks for them', () => {
    const smart = withColumn(EMPTY_SMART, 'force', { unit: 'kN', notation: 'si' });
    const model = buildModel(grid, smart, EN_US);
    expect(shownFor(model, smart, 1, 1, EN_US)?.text).toBe('−750 N');
    // A cell that already reads as the column would write it shows as typed.
    expect(shownFor(model, smart, 0, 1, EN_US)).toBeNull();
  });
});
