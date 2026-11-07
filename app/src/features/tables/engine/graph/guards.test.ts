// Guards on what a note can hold: iteration limits, legacy array blocks, LET names, error explanations, and row
// changes that other tables read. Expected values are worked by hand or come from Excel's documented limits.

import { describe, expect, it } from 'vitest';
import { createTable, setCellInput } from '../edit';
import { explainOrigin } from '../formula/explain';
import { EN_US } from '../locale';
import type { Table } from '../model';
import { errorOrigin, recalculate, type EngineEnv } from '../recalc';
import { err, type Value } from '../values';
import { changeBookRows, recalculateBook } from '../workbook';

const ENV: EngineEnv = { today: () => 46_000 };

/** A table with Excel's rules (data.sheet.v 1) and number columns A to D. */
function sheet(data: string[][], extra: Partial<Table> = {}): Table {
  const columns = ['A', 'B', 'C', 'D'].map((name) => ({ name, type: 'number' as const }));
  const table = createTable(columns, data, EN_US, ENV, 1);
  return Object.keys(extra).length === 0 ? table : recalculate({ ...table, ...extra }, ENV);
}

function type(t: Table, ref: string, raw: string): Table {
  return setCellInput(t, { row: Number(ref.slice(1)) - 1, col: ref.charCodeAt(0) - 65, raw }, EN_US, ENV);
}

const at = (t: Table, ref: string): Value => t.rows[Number(ref.slice(1)) - 1].cells[ref.charCodeAt(0) - 65].value;
const column = (t: Table, col: number): Value[] => t.rows.map((r) => r.cells[col].value);
const blank = (rows: number): string[][] => Array.from({ length: rows }, () => ['', '', '', '']);

describe('iteration limits (gap G2)', () => {
  it("caps passes at Excel's documented 32,767 and reads a change that is not a number as the default", () => {
    const start = performance.now();
    const t = type(sheet(blank(1), { iterate: { max: 1e9, change: Number.NaN } }), 'A1', '=A1+1');
    expect(at(t, 'A1')).toBe(32_767);
    const forever = type(sheet(blank(1), { iterate: { max: Infinity, change: 0 } }), 'A1', '=A1+1');
    expect(at(forever, 'A1')).toBe(32_767);
    expect(performance.now() - start).toBeLessThan(3000);
    // With the default change of 0.001, A1 = (A1+10)/2 stops once a pass moves it by less than that.
    const settled = type(sheet(blank(1), { iterate: { max: 1e9, change: Number.NaN } }), 'A1', '=(A1+10)/2');
    expect(Math.abs((at(settled, 'A1') as number) - 10)).toBeLessThan(0.002);
  });
});

describe('legacy array blocks (gap G3)', () => {
  it('gives #REF! for a block that is not whole or does not fit, and never throws', () => {
    const t = sheet([
      ['1', '', '', ''],
      ['2', '', '', ''],
      ['3', '', '', ''],
    ]);
    const bad = [
      { rows: Number.NaN, cols: 1 },
      { rows: -1, cols: 1 },
      { rows: 1.5, cols: 1 },
      { rows: 1e6, cols: 1e6 },
      { rows: 4, cols: 1 },
      { rows: 1, cols: 3 },
    ];
    for (const array of bad) {
      const cell = { raw: '={1;2}', value: null, formula: '{1;2}', array };
      const rows = t.rows.map((row, r) =>
        r === 0 ? { ...row, cells: row.cells.map((c, i) => (i === 2 ? cell : c)) } : row,
      );
      expect([array, at(recalculate({ ...t, rows }, ENV), 'C1')]).toEqual([array, err('REF')]);
    }
  });
});

describe('LET names (gap G8)', () => {
  it('gives #VALUE! when one LET repeats a name, in any case', () => {
    let t = sheet(blank(1));
    t = type(t, 'A1', '=LET(x,1,x,2,x)');
    t = type(t, 'B1', '=LET(x,1,X,2,x)');
    t = type(t, 'C1', '=LET(x,1,LET(x,2,x))');
    expect([at(t, 'A1'), at(t, 'B1'), at(t, 'C1')]).toEqual([err('VALUE'), err('VALUE'), 2]);
  });
});

describe('error explanations (gap G4)', () => {
  it('explains an origin only through the strings the caller passes, with no text of its own', () => {
    let t = sheet([['1', '0', '', '']]);
    t = type(t, 'C1', '=A1/B1');
    t = type(t, 'D1', '=C1+1');
    const cellName = (cell: { col: number; row: number }) => `R${cell.row + 1}C${cell.col + 1}`;
    const say = (key: string, values: object) => `${key} ${JSON.stringify(values)}`;
    expect(explainOrigin(errorOrigin(t, 2, 0)!, cellName, say)).toBe('operator {"name":"/"}');
    expect(explainOrigin(errorOrigin(t, 3, 0)!, cellName, say)).toBe('cell {"cell":"R1C3"}');
    expect(explainOrigin({ code: 'SPILL', kind: 'spill' }, cellName, say)).toBe('spillNoRoom {}');
    expect(explainOrigin({ code: 'NAME', kind: 'name', name: 'nothing' }, cellName, say)).toBe(
      'name {"name":"nothing"}',
    );
  });
});

describe('row changes on a page (gap G7)', () => {
  it('rewrites references from other tables when rows are inserted into or deleted from Sales', () => {
    const sales: Table = {
      ...createTable(
        [{ name: 'Region' }, { name: 'Amount', type: 'number' }],
        [
          ['East', '10'],
          ['West', '20'],
        ],
        EN_US,
        ENV,
        1,
      ),
      name: 'Sales',
    };
    const report = createTable([{ name: 'Total', type: 'number' }], [['=Sales!B2*2'], ['=Sales!B1']], EN_US, ENV, 1);
    let book = recalculateBook([sales, report], ENV);
    expect(column(book[1], 0)).toEqual([40, 10]);
    book = changeBookRows(book, 0, { kind: 'insertRows', at: 0, count: 1 }, ENV);
    expect(book[0].rows.length).toBe(3);
    expect(book[1].rows.map((row) => row.cells[0].formula)).toEqual(['Sales!B3*2', 'Sales!B2']);
    expect(column(book[1], 0)).toEqual([40, 10]);
    book = changeBookRows(book, 0, { kind: 'deleteRows', at: 1, count: 1 }, ENV);
    expect(book[1].rows.map((row) => row.cells[0].formula)).toEqual(['Sales!B2*2', 'Sales!#REF!']);
    expect(column(book[1], 0)).toEqual([40, err('REF')]);
  });
});
