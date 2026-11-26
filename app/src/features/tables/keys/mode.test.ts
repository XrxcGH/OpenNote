// Which keys a table uses (PLAN.md decision 4): its stored choice, else spreadsheet keys when it holds a number or a
// formula. The choice is a key of data.sheet.table that the sheet model accepts (R-SHT-10).
import { describe, expect, it } from 'vitest';
import { sheetProblems } from '../sheet/model';
import { isSheetValue, keysOf, keysPatch, storedKeys } from './mode';

describe('table keys', () => {
  it('reads a cell of a digit, a long run of spaces, and a letter quickly, as text', () => {
    const start = performance.now();
    expect(isSheetValue(`1${' '.repeat(100_000)}a`)).toBe(false);
    expect(performance.now() - start).toBeLessThan(200);
  });

  it('uses the stored choice first', () => {
    expect(keysOf({ sheet: { table: { keys: 'document' } } }, [['=1+2']])).toBe('document');
    expect(keysOf({ sheet: { table: { keys: 'spreadsheet' } } }, [['words']])).toBe('spreadsheet');
    expect(storedKeys({ sheet: { table: { keys: 'later' } } })).toBeNull();
  });

  it('gives an older table spreadsheet keys only when it holds a number or a formula', () => {
    expect(
      keysOf({}, [
        ['Stage', 'Where'],
        ['Prophase', 'Nucleus'],
      ]),
    ).toBe('document');
    expect(
      keysOf({}, [
        ['Item', 'Cost'],
        ['Pens', '$1,250.50'],
      ]),
    ).toBe('spreadsheet');
    expect(keysOf({}, [['Total'], ['=SUM(A1:A2)']])).toBe('spreadsheet');
    expect(['12', '-3.5', '45%', '1e3', '€ 9'].every(isSheetValue)).toBe(true);
    expect(['', '=', 'Room 12', '12 apples', '2026-11-07'].some(isSheetValue)).toBe(false);
  });

  it('stores the choice as a merge patch that the sheet model accepts', () => {
    expect(keysPatch('document')).toEqual({ sheet: { table: { keys: 'document' } } });
    expect(sheetProblems({ table: { keys: 'document' } }, 'sheet')).toEqual([]);
    expect(sheetProblems({ table: { keys: 'grid' } }, 'sheet')).not.toEqual([]);
  });
});
