import { describe, expect, it } from 'vitest';
import { applyToRange } from './apply';
import { activeMerges } from './merges';
import { canonical, isObject, ordered, type Json } from './json';
import { applyOrder } from './rules';
import { dropOrphans, orphans, readSheet, sheetPatch, tidy, writeSheet } from './sheet';
import { K, R, makeTable, ownCases, range, specCase, specCases } from './testing';
import type { Sheet } from './types';

/** True when every object of `value` has its keys in code point order. */
function inOrder(value: Json): boolean {
  if (Array.isArray(value)) return value.every(inOrder);
  if (!isObject(value)) return true;
  const keys = Object.keys(value);
  return canonical(keys) === canonical([...keys].sort()) && keys.every((k) => inOrder(value[k]));
}

describe('readSheet and writeSheet', () => {
  it('has the lane fixtures', () => {
    expect(ownCases().map((c) => c.file)).toEqual(['every-key.json', 'future-keys.json', 'invalid-values.json']);
  });

  it.each(ownCases().map((c) => [c.file, c] as const))('round-trips %s with unknown keys kept', (_file, c) => {
    const sheet = readSheet(c.data);
    expect(writeSheet(sheet)).toEqual(c.data.sheet);
    // A save tidies the sheet; the table holds every row and column, so nothing a later version wrote goes.
    tidy(sheet, c.data);
    expect(canonical(writeSheet(sheet) as Json)).toBe(canonical(c.data.sheet as Json));
  });

  it('round-trips every spec fixture', () => {
    for (const c of specCases()) {
      const written = writeSheet(readSheet(c.data));
      expect(written ?? undefined, c.file).toEqual(c.data.sheet);
      if (written) expect(inOrder(written), c.file).toBe(true);
    }
  });

  it('writes keys in code point order at every level', () => {
    const written = writeSheet({
      values: { b: { z: 1, a: 2 } },
      cells: { r: { y: 's', x: 't' } },
      a: [{ d: 1, c: 2 }],
    });
    expect(Object.keys(written ?? {})).toEqual(['a', 'cells', 'values']);
    expect(inOrder(written as Json)).toBe(true);
  });

  it('reads a missing or broken sheet as empty, and copies the data it reads', () => {
    expect(readSheet({})).toEqual({});
    expect(readSheet({ sheet: [1] })).toEqual({});
    expect(readSheet(null)).toEqual({});
    const data = { sheet: { table: { name: 'Prices' } } };
    const sheet = readSheet(data);
    (sheet.table as Sheet).name = 'Other';
    expect(data.sheet.table.name).toBe('Prices');
    expect(writeSheet({})).toBeNull();
  });

  it('keeps a key named like an Object.prototype property as data', () => {
    const data = JSON.parse('{"sheet":{"names":{"__proto__":{"ref":"1"},"constructor":{"ref":"2"}}}}') as Json;
    const written = writeSheet(readSheet(data));
    expect(Object.keys((written as { names: object }).names)).toEqual(['__proto__', 'constructor']);
  });
});

describe('orphans (R-SHT-2)', () => {
  it('finds the entries the spec fixture lists for rows and columns Beta 8 deleted', () => {
    const c = specCase('beta8-after.json');
    expect(orphans(c.data.sheet as Sheet, c.data)).toEqual(c.expect?.orphans);
    const sheet = readSheet(c.data);
    dropOrphans(sheet, c.data);
    expect(orphans(sheet, c.data)).toEqual([]);
    expect(sheet.styles).toBeDefined();
    tidy(sheet, c.data);
    expect(sheet).toEqual({});
  });

  it('drops cells of deleted columns inside rows that remain', () => {
    const table = makeTable(range(1, 2), range(1, 2));
    const sheet: Sheet = {
      cells: { [R(1)]: { [K(1)]: 'aaaaaa', [K(9)]: 'aaaaaa' } },
      styles: { aaaaaa: { fill: 'ink' } },
    };
    expect(orphans(sheet, table)).toEqual([`cells.${R(1)}.${K(9)}`]);
    tidy(sheet, table);
    expect(sheet.cells).toEqual({ [R(1)]: { [K(1)]: 'aaaaaa' } });
  });
});

describe('sheetPatch', () => {
  const table = makeTable(range(1, 2), range(1, 2));

  it('sends the whole sheet the first time, then only what changed, and null to remove it', () => {
    const first = applyToRange({}, table, [R(1), K(1)], [R(1), K(1)], { fill: 'fern' });
    expect(first.patch).toEqual({ sheet: writeSheet(first.sheet) });
    const second = applyToRange(first.sheet, table, [R(2), K(2)], [R(2), K(2)], { fill: 'fern' });
    const id = Object.keys(first.sheet.styles as object)[0];
    expect(second.patch).toEqual({ sheet: { cells: { [R(2)]: { [K(2)]: id } } } });
    const cleared = applyToRange(second.sheet, table, [R(1), K(1)], [R(2), K(2)], { fill: null });
    expect(cleared.patch).toEqual({ sheet: null });
    expect(sheetPatch({}, {})).toBeNull();
  });
});

describe('rules (R-SHT-14, R-SHT-15, R-SHT-22)', () => {
  it('orders conditional formats as the spec fixtures list', () => {
    for (const file of ['conditional.json', 'conditional-types.json']) {
      const c = specCase(file);
      expect(applyOrder(c.data.sheet as Sheet), file).toEqual(c.expect?.applyOrder);
    }
  });

  it('keeps every rule, merge, and name of the spec fixtures through a save', () => {
    for (const file of ['validation.json', 'validation-kinds.json', 'conditional-types.json', 'names-kinds.json']) {
      const c = specCase(file);
      const sheet = readSheet(c.data);
      tidy(sheet, c.data);
      expect(ordered(sheet), file).toEqual(ordered(c.data.sheet as Json));
    }
    const merges = specCase('merges.json');
    const sheet = readSheet(merges.data);
    tidy(sheet, merges.data);
    expect(Object.keys(sheet.merges as object)).toEqual(activeMerges(sheet, merges.data).map((m) => m.id));
  });
});
