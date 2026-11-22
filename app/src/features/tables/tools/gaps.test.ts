import { describe, expect, it } from 'vitest';
import { createTable } from '../engine/edit';
import { filterIndices } from '../engine/filter';
import { EN_US } from '../engine/locale';
import { sortedIndices } from '../engine/sort';
import { applyTextToColumns, MAX_SPLIT_COLUMNS, sheetLookOf } from './apply';
import { removeDuplicates } from './rows';
import { sortColumnsByRows } from './sortColumns';

const semi = { mode: 'delimited', delimiters: [';'] } as const;

describe('remove duplicates in one pass', () => {
  it('shifts a range once for several separate runs of removed rows', () => {
    // Hand-worked: B repeats at rows 3 and 4 (x, y), so A=3 and A=4 go. SUM(A1:A5) becomes SUM(A1:A3) = 1+2+5 = 8.
    const t = createTable(
      [{ name: 'A', type: 'number' }, { name: 'B' }],
      [
        ['1', 'x'],
        ['2', 'y'],
        ['3', 'x'],
        ['4', 'y'],
        ['5', 'z'],
        ['=SUM(A1:A5)', 'total'],
      ],
      EN_US,
    );
    const done = removeDuplicates(t, [1]);
    expect(done.removed).toBe(2);
    expect(done.table.rows).toHaveLength(4);
    const sum = done.table.rows[3].cells[0];
    expect(sum.formula).toBe('SUM(A1:A3)');
    expect(sum.value).toBe(8);
  });

  it('removes 5,000 of 10,000 rows with a formula column in far less than the per-row time', () => {
    const rows = Array.from({ length: 10000 }, (_, i) => [String(Math.floor(i / 2)), String(i), '']);
    const t = createTable(
      [{ name: 'K' }, { name: 'N', type: 'number' }, { name: 'D', formula: '[@N]*2' }],
      rows,
      EN_US,
    );
    const start = performance.now();
    const done = removeDuplicates(t, [0]);
    const ms = performance.now() - start;
    expect(done.removed).toBe(5000);
    expect(done.table.rows[4999].cells[2].value).toBe(9998 * 2);
    // The bound is loose for a loaded machine; the per-row delete took tens of seconds here.
    expect(ms).toBeLessThan(2500);
  });
});

describe('sort left to right', () => {
  it('orders the columns by a row and lets references follow the columns', () => {
    // Hand-worked: row 1 holds 3, 1, 2 in A, B, C. Ascending gives B, C, A. The cell =A1 follows A to the third column.
    const t = createTable(
      [
        { name: 'A', type: 'number' },
        { name: 'B', type: 'number' },
        { name: 'C', type: 'number' },
      ],
      [
        ['3', '1', '2'],
        ['10', '20', '=A1'],
      ],
      EN_US,
    );
    const done = sortColumnsByRows(t, [{ row: 0 }], EN_US);
    expect(done.columns.map((c) => c.name)).toEqual(['B', 'C', 'A']);
    expect(done.rows[0].cells.map((c) => c.raw)).toEqual(['1', '2', '3']);
    expect(done.rows[1].cells[1].formula).toBe('C1');
    expect(done.rows[1].cells.map((c) => c.value)).toEqual([20, 3, 10]);
  });

  it('sorts descending and keeps fixed leading columns', () => {
    const t = createTable([{ name: 'L' }, { name: 'A' }, { name: 'B' }], [['z', '1', '2']], EN_US);
    const done = sortColumnsByRows(t, [{ row: 0, desc: true }], EN_US, { fixed: 1 });
    expect(done.columns.map((c) => c.name)).toEqual(['L', 'B', 'A']);
  });

  it('returns the same table when the order already holds', () => {
    const t = createTable([{ name: 'A' }, { name: 'B' }], [['1', '2']], EN_US);
    expect(sortColumnsByRows(t, [{ row: 0 }], EN_US)).toBe(t);
  });
});

describe('text to columns limits', () => {
  it('refuses a split that would add more columns than the limit', () => {
    const cell = Array.from({ length: MAX_SPLIT_COLUMNS + 10 }, () => 'x').join(';');
    const t = createTable([{ name: 'A' }], [[cell]], EN_US);
    const done = applyTextToColumns(t, 0, semi, EN_US);
    expect(done.refused).toBe('tooMany');
    expect(done.table).toBe(t);
  });

  it('names new columns so no name repeats', () => {
    const t = createTable([{ name: 'A' }, { name: 'A 2' }], [['p;q', 'r']], EN_US);
    const done = applyTextToColumns(t, 0, semi, EN_US);
    expect(done.table.columns.map((c) => c.name)).toEqual(['A', 'A 3', 'A 2']);
  });
});

describe('look of a cell as the grid resolves it', () => {
  const t = createTable([{ name: 'N' }], [['a'], ['b'], ['c'], ['d']], EN_US);
  const sheet = { table: { look: 'x', band: { rows: true } } };
  const hooks = { namedLook: (_: string, element: string) => (element === 'band2' ? { fill: 'amber' } : undefined) };
  const fills = (look: ReturnType<typeof sheetLookOf>): (string | undefined)[] =>
    t.rows.map((_, r) => look(r, 0, 'fill'));

  it('counts banding from the row under the header', () => {
    expect(fills(sheetLookOf(sheet, t, hooks))).toEqual([undefined, 'amber', undefined, 'amber']);
    expect(fills(sheetLookOf(sheet, t, { ...hooks, header: true }))).toEqual([
      undefined,
      undefined,
      'amber',
      undefined,
    ]);
  });

  it('counts banding over the rows a filter shows', () => {
    // Row b is hidden: the shown rows a, c, d band as band1, band2, band1.
    const look = sheetLookOf(sheet, t, { ...hooks, hiddenRows: new Set([t.rows[1].id]) });
    expect(fills(look)).toEqual([undefined, undefined, 'amber', undefined]);
  });
});

describe('filter by color without a look', () => {
  it('puts no limit on the rows, so totals and charts agree with the grid', () => {
    const t = createTable([{ name: 'N' }], [['a'], ['b']], EN_US);
    expect(filterIndices(t, [{ column: 0, op: 'fill', value: 'amber' }])).toEqual([0, 1]);
    expect(filterIndices(t, [{ column: 0, op: 'fontColor', value: 'red' }])).toEqual([0, 1]);
  });
});

describe('custom list case', () => {
  const t = createTable([{ name: 'M' }], [['zed'], ['Jan'], ['jan'], ['feb']], EN_US);
  it('matches list names without regard to case by default', () => {
    const order = sortedIndices(t, [{ column: 0, customList: ['jan', 'feb'] }], EN_US).map(
      (i) => t.rows[i].cells[0].raw,
    );
    expect(order).toEqual(['Jan', 'jan', 'feb', 'zed']);
  });
  it('matches case when caseSensitive is set, so only the spelling on the list is listed', () => {
    const order = sortedIndices(t, [{ column: 0, customList: ['jan', 'feb'], caseSensitive: true }], EN_US).map(
      (i) => t.rows[i].cells[0].raw,
    );
    expect(order.slice(0, 2)).toEqual(['jan', 'feb']);
  });
  it('reverses the listed items when descending and still puts unlisted text last', () => {
    const order = sortedIndices(t, [{ column: 0, customList: ['jan', 'feb'], desc: true }], EN_US).map(
      (i) => t.rows[i].cells[0].raw,
    );
    expect(order).toEqual(['feb', 'Jan', 'jan', 'zed']);
  });
});
