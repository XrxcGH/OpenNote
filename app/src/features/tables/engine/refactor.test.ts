// Reference adjustment, from Excel's documented behavior on inserting and deleting rows and columns. Expected
// formulas are worked by hand.

import { describe, expect, it } from 'vitest';
import { createTable, deleteRow, insertRows, moveRows } from './edit';
import { EN_US } from './locale';
import { adjustFormula, adjustNames, adjustTable } from './refactor';
import { err } from './values';

const columns = ['A', 'B', 'C', 'D'].map((name) => ({ name, type: 'number' as const }));

describe('reference adjustment of rows', () => {
  it('moves, breaks, and grows references on insert and delete (lane test)', () => {
    const base = createTable(
      columns,
      [
        ['1', '1', '1', ''],
        ['', '2', '3', '=B2*C2'],
        ['', '4', '5', ''],
      ],
      EN_US,
      undefined,
      1,
    );
    expect(base.rows[1].cells[3].value).toBe(6);
    const inserted = insertRows(base, 1);
    const moved = inserted.rows[2].cells[3];
    expect(moved.raw).toBe('=B3*C3');
    expect(moved.formula).toBe('B3*C3');
    expect(moved.value).toBe(6);
    expect(inserted.rows[1].cells.every((cell) => cell.raw === '')).toBe(true);

    const reading = createTable(
      columns,
      [
        ['', '', '', ''],
        ['', '', '', '=B3*C3'],
        ['', '2', '3', ''],
      ],
      EN_US,
      undefined,
      1,
    );
    const deleted = deleteRow(reading, 2);
    expect(deleted.rows[1].cells[3].raw).toBe('=#REF!*#REF!');
    expect(deleted.rows[1].cells[3].value).toEqual(err('REF'));

    expect(adjustFormula('SUM(B2:B5)', { kind: 'insertRows', at: 2, count: 1 })).toBe('SUM(B2:B6)');
  });
});

describe('reference adjustment of ranges', () => {
  it('shrinks a range when rows inside it go, and breaks it when all of them go', () => {
    const del = (at: number, count: number) => ({ kind: 'deleteRows' as const, at, count });
    expect(adjustFormula('SUM(B2:B6)', del(2, 1))).toBe('SUM(B2:B5)');
    expect(adjustFormula('SUM(B2:B6)', del(0, 2))).toBe('SUM(B1:B4)');
    expect(adjustFormula('SUM(B2:B6)', del(4, 5))).toBe('SUM(B2:B4)');
    expect(adjustFormula('SUM(B2:B3)', del(1, 2))).toBe('SUM(#REF!)');
    expect(adjustFormula('SUM(B:B)', del(1, 2))).toBe('SUM(B:B)');
  });

  it('moves a range on an insert at its first row, and leaves it on an insert just below it', () => {
    const ins = (at: number) => ({ kind: 'insertRows' as const, at, count: 2 });
    expect(adjustFormula('SUM(B2:B5)', ins(1))).toBe('SUM(B4:B7)');
    expect(adjustFormula('SUM(B2:B5)', ins(5))).toBe('SUM(B2:B5)');
    expect(adjustFormula('SUM(B2:B5)', ins(4))).toBe('SUM(B2:B7)');
  });

  it('keeps dollar signs and every other character as written', () => {
    const ins = { kind: 'insertRows' as const, at: 0, count: 1 };
    expect(adjustFormula('$B$2 + "B2"&  B$3 ', ins)).toBe('$B$3 + "B2"&  B$4 ');
    expect(adjustFormula('[Price]*2 + Sales[Amount]', ins)).toBe('[Price]*2 + Sales[Amount]');
    expect(adjustFormula('SUM(A1#)+$2:$3', ins)).toBe('SUM(A2#)+$3:$4');
    expect(adjustFormula('1+', ins)).toBe('1+');
  });
});

describe('reference adjustment of columns and moves', () => {
  it('adjusts columns too', () => {
    expect(adjustFormula('B2+D2', { kind: 'insertCols', at: 2, count: 1 })).toBe('B2+E2');
    expect(adjustFormula('B2+D2', { kind: 'deleteCols', at: 1, count: 1 })).toBe('#REF!+C2');
    expect(adjustFormula('SUM(A1:D1)', { kind: 'deleteCols', at: 1, count: 2 })).toBe('SUM(A1:B1)');
    expect(adjustFormula('SUM(2:2)', { kind: 'deleteCols', at: 1, count: 2 })).toBe('SUM(2:2)');
  });

  it('lets moved cells take their references along', () => {
    const move = { kind: 'moveRows' as const, from: 0, count: 1, to: 2 };
    expect(adjustFormula('A1+A2+A3+A4', move)).toBe('A3+A1+A2+A4');
    const t = createTable(columns, [['1', '=A1*10'], ['2'], ['3']], EN_US, undefined, 1);
    const moved = moveRows(t, 0, 1, 2);
    expect(moved.rows[2].cells[1].raw).toBe('=A3*10');
    expect(moved.rows[2].cells[1].value).toBe(10);
  });

  it('adjusts only references into the changed table from another one', () => {
    const ins = { kind: 'insertRows' as const, at: 0, count: 1 };
    expect(adjustFormula('Sales!B2+B2', ins, { otherTable: 'Sales' })).toBe('Sales!B3+B2');
    expect(adjustFormula('Sales!B2+B2', ins, { tableName: 'Sales' })).toBe('Sales!B3+B3');
    expect(adjustFormula('Other!B2+B2', ins, { tableName: 'Sales' })).toBe('Other!B2+B3');
  });
});

describe('reference adjustment of names', () => {
  it('rewrites names and calculated columns with the table', () => {
    const names = adjustNames(
      [
        { name: 'Top', ref: 'A1:A3' },
        { name: 'Rate', ref: '0.5' },
      ],
      {
        kind: 'deleteRows',
        at: 0,
        count: 1,
      },
    );
    expect(names).toEqual([
      { name: 'Top', ref: 'A1:A2' },
      { name: 'Rate', ref: '0.5' },
    ]);
    const t = createTable(
      [...columns.slice(0, 3), { name: 'D', formula: 'A2*[B]' }],
      [
        ['1', '2'],
        ['3', '4'],
      ],
      EN_US,
    );
    const adjusted = adjustTable(t, { kind: 'insertRows', at: 0, count: 1 });
    expect(adjusted.columns[3].formula).toBe('A3*[B]');
    expect(adjustTable(t, { kind: 'insertRows', at: 9, count: 1 })).toBe(t);
  });
});
