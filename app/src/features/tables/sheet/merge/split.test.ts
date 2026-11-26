import { describe, expect, it } from 'vitest';
import { readSplit } from './split';

describe('the split dialog input', () => {
  it('accepts whole numbers with 2 to 64 cells in all', () => {
    expect(readSplit('3', '2')).toEqual({ ok: true, columns: 3, rows: 2 });
    expect(readSplit(' 8 ', '8')).toEqual({ ok: true, columns: 8, rows: 8 });
    expect(readSplit('1', '2')).toEqual({ ok: true, columns: 1, rows: 2 });
  });

  it('names the field that is wrong', () => {
    expect(readSplit('0', '2')).toMatchObject({ ok: false, field: 'columns' });
    expect(readSplit('x', '2')).toMatchObject({ ok: false, field: 'columns' });
    expect(readSplit('2', '1.5')).toMatchObject({ ok: false, field: 'rows' });
    expect(readSplit('2', '')).toMatchObject({ ok: false, field: 'rows' });
  });

  it('refuses 1 cell and more than 64 cells', () => {
    expect(readSplit('1', '1')).toMatchObject({ ok: false, field: 'both' });
    expect(readSplit('9', '8')).toMatchObject({ ok: false, field: 'both' });
    expect(readSplit('65', '1')).toMatchObject({ ok: false, field: 'both' });
  });
});
