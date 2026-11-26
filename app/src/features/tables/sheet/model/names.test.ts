import { describe, expect, it } from 'vitest';
import { deleteName, findName, lookupName, namesOf, pageNames, setName, tableName } from './names';
import { rangeBox, repairRanges, rulesAt, validationAt } from './rules';
import { gridOf } from './grid';
import { tidy } from './sheet';
import { K, R, makeTable, range, specCase } from './testing';
import type { Sheet, TableLike } from './types';

describe('names (R-SHT-13)', () => {
  it('reads every kind of name of the spec fixture with its scope', () => {
    const c = specCase('names-kinds.json');
    const names = namesOf(c.data.sheet as Sheet);
    expect(names.length).toBe(Object.keys((c.data.sheet as { names: object }).names).length);
    expect(names.every((n) => n.scope === 'table' || n.scope === 'page')).toBe(true);
  });

  it('keeps names unique without regard to case, and refuses what R-SHT-13 refuses', () => {
    const sheet: Sheet = {};
    expect(setName(sheet, 'TaxRate', { ref: '0.0825' })).toBeNull();
    expect(setName(sheet, 'taxrate', { ref: '0.09', scope: 'page' })).toBeNull();
    expect(sheet.names).toEqual({ taxrate: { ref: '0.09', scope: 'page' } });
    expect(findName(sheet, 'TAXRATE')?.ref).toBe('0.09');
    expect(setName(sheet, 'A1', { ref: '1' })).toBe('name');
    expect(setName(sheet, 'Ok', { ref: '' })).toBe('ref');
    expect(setName(sheet, 'Ok', { ref: '1', comment: 'x'.repeat(256) })).toBe('comment');
    deleteName(sheet, 'TaxRate');
    expect(sheet.names).toBeUndefined();
  });

  it('looks a name up in its table first, then on the page, where the first table wins', () => {
    const own: Sheet = { names: { Rate: { ref: '1' } } };
    const first: Sheet = { names: { Rate: { ref: '2', scope: 'page' }, Fee: { ref: '3', scope: 'page' } } };
    const second: Sheet = { names: { fee: { ref: '4', scope: 'page' } }, table: { name: 'Sales' } };
    const page = [first, second];
    expect(lookupName(own, page, 'rate')?.ref).toBe('1');
    expect(lookupName({}, page, 'FEE')?.ref).toBe('3');
    expect(pageNames(page).conflicts).toEqual(['fee']);
    expect(tableName(second)).toBe('Sales');
    expect(tableName({ table: { name: 'B2' } })).toBeUndefined();
  });
});

describe('ranges and rules (R-SHT-14, R-SHT-22)', () => {
  const table = makeTable(range(1, 4), range(1, 3));

  it('covers whole columns, whole rows, and boxes between corners, and ignores missing IDs', () => {
    const grid = gridOf(table);
    expect(rangeBox(grid, { col: K(2) })).toEqual({ top: 0, bottom: 3, left: 1, right: 1 });
    expect(rangeBox(grid, { row: R(3) })).toEqual({ top: 2, bottom: 2, left: 0, right: 2 });
    expect(rangeBox(grid, { from: [R(4), K(3)], to: [R(2), K(2)] })).toEqual({ top: 1, bottom: 3, left: 1, right: 2 });
    expect(rangeBox(grid, { col: K(9) })).toBeNull();
  });

  it('finds the rules that cover a cell, and conditional formats in the order they apply', () => {
    const sheet: Sheet = {
      validation: {
        v2: { ranges: [{ col: K(1) }], kind: 'whole' },
        v1: { ranges: [{ row: R(1) }], kind: 'list', items: ['a'] },
      },
      conditional: {
        c2: { order: 1, type: 'blank', ranges: [{ col: K(1) }], style: 'aaaaaa' },
        c1: { order: 2, type: 'noBlank', ranges: [{ col: K(1) }], style: 'aaaaaa' },
        c0: { order: 1, type: 'later', ranges: [{ col: K(1) }] },
      },
    };
    expect(validationAt(sheet, table, 0, 0)?.id).toBe('v1');
    expect(validationAt(sheet, table, 2, 0)?.id).toBe('v2');
    expect(rulesAt(sheet, table, 'conditional', 0, 0).map((r) => r.id)).toEqual(['c2', 'c1']);
  });

  it('moves range corners like merges, drops ranges of deleted lines, and keeps shapes it does not know', () => {
    const sheet: Sheet = {
      validation: {
        v1: { ranges: [{ from: [R(1), K(1)], to: [R(4), K(2)] }, { col: K(3) }, { rows: [R(1)] }], kind: 'any' },
        v2: { ranges: [{ row: R(2) }], kind: 'any' },
      },
    };
    const after: TableLike = {
      ...table,
      rows: table.rows.filter((r) => r.id !== R(4) && r.id !== R(2)),
      columns: table.columns.filter((c) => c.id !== K(3)),
    };
    repairRanges(sheet, table, after);
    expect(sheet.validation).toEqual({
      v1: { ranges: [{ from: [R(1), K(1)], to: [R(3), K(2)] }, { rows: [R(1)] }], kind: 'any' },
    });
    tidy(sheet, after, after);
    expect(Object.keys(sheet.validation as object)).toEqual(['v1']);
  });
});
