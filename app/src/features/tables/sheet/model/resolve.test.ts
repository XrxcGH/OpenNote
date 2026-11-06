// checks-disable-file brand-consistency: cell colors here are document data of the file format, not interface styling
import { afterEach, describe, expect, it } from 'vitest';
import { applyToColumns, applyToRange, applyToRows, applyToTable } from './apply';
import { applyPatch, type Json } from './json';
import { DEFAULT_STYLE, layer, lookElements, resolve } from './resolve';
import { setConditionalLayer } from './rules';
import { K, R, makeTable, range, specCase } from './testing';
import type { Sheet } from './types';

const fill = (sheet: Sheet, table: ReturnType<typeof makeTable>, row: number, col: number) =>
  resolve(sheet, table, R(row), K(col)).style.fill;

describe('resolve (R-SHT-9)', () => {
  const table = makeTable(range(1, 5), range(1, 5));

  it('lets the row applied last win over the cell, as Excel copies row formats onto cells', () => {
    let { sheet } = applyToColumns({}, table, [K(3)], { fill: 'indigo' });
    sheet = applyToRange(sheet, table, [R(3), K(3)], [R(3), K(3)], { fill: 'amber' }).sheet;
    expect(fill(sheet, table, 3, 3)).toBe('amber');
    sheet = applyToRows(sheet, table, [R(3)], { fill: 'fern' }).sheet;
    expect(fill(sheet, table, 3, 3)).toBe('fern');
    expect(fill(sheet, table, 3, 4)).toBe('fern');
    expect(fill(sheet, table, 4, 3)).toBe('indigo');
    // The cell style lost its fill, so the amber style is gone from the style sheet.
    expect(Object.values(sheet.styles as object)).toEqual(expect.not.arrayContaining([{ fill: 'amber' }]));
    expect(sheet.cells).toBeUndefined();
  });

  it('lets a column applied after a row win where they cross, and nowhere else', () => {
    let { sheet } = applyToRows({}, table, [R(2)], { fill: 'fern', font: { bold: true } });
    sheet = applyToColumns(sheet, table, [K(2)], { fill: 'plum' }).sheet;
    expect(fill(sheet, table, 2, 2)).toBe('plum');
    expect(fill(sheet, table, 2, 3)).toBe('fern');
    expect(fill(sheet, table, 4, 2)).toBe('plum');
    expect(resolve(sheet, table, R(2), K(2)).style.font?.bold).toBe(true);
  });

  it('clears the property from rows, columns, and cells when the whole table gets it', () => {
    let { sheet } = applyToRows({}, table, [R(1)], { align: { h: 'center', v: 'middle' } });
    sheet = applyToColumns(sheet, table, [K(1)], { align: { h: 'right' } }).sheet;
    sheet = applyToRange(sheet, table, [R(5), K(5)], [R(5), K(5)], { align: { h: 'left' } }).sheet;
    sheet = applyToTable(sheet, table, { align: { h: 'justify' } }).sheet;
    for (const [r, c] of [
      [1, 1],
      [1, 3],
      [3, 1],
      [5, 5],
    ]) {
      expect(resolve(sheet, table, R(r), K(c)).style.align?.h).toBe('justify');
    }
    expect(resolve(sheet, table, R(1), K(3)).style.align?.v).toBe('middle');
  });

  it('returns one merge patch that turns the old data into the new', () => {
    const before = applyToColumns({}, table, [K(3)], { fill: 'indigo' }).sheet;
    const { sheet, patch } = applyToRows(before, table, [R(3)], { fill: 'fern' });
    expect(patch).not.toBeNull();
    const data = applyPatch({ sheet: before } as Json, patch as Json) as { sheet: Sheet };
    expect(data.sheet).toEqual(sheet);
    expect(applyToRows(sheet, table, [R(3)], { fill: 'fern' }).patch).toBeNull();
  });

  it('merges font, alignment, padding, protection, and borders key by key, and replaces fills and sides', () => {
    const lower = {
      fill: { pattern: 'solid', color: 'ink' },
      font: { bold: true, size: 12 },
      border: { t: { style: 'thin', color: 'ink' } },
    };
    const upper = { fill: 'fern', font: { size: 14 }, border: { t: { style: 'double' }, b: { style: 'thin' } } };
    expect(layer(lower, upper)).toEqual({
      fill: 'fern',
      font: { bold: true, size: 14 },
      border: { t: { style: 'double' }, b: { style: 'thin' } },
    });
  });

  it('starts from the defaults of R-SHT-8 and the table padding', () => {
    expect(resolve({}, table, R(1), K(1)).style).toEqual(DEFAULT_STYLE);
    const padded = resolve({ table: { pad: { l: 8 } } }, table, R(1), K(1)).style;
    expect(padded.pad).toEqual({ t: 2, r: 4, b: 2, l: 8 });
  });

  it('names the layers in the order the spec fixture lists, below the run marks', () => {
    const expected = specCase('style-keys.json').expect?.layers as string[];
    const sheet: Sheet = {
      styles: {
        aaaaaa: { fill: 'ink' },
        bbbbbb: { fill: 'brick' },
        cccccc: { fill: 'fern' },
        dddddd: { fill: 'plum' },
      },
      table: { style: 'aaaaaa', look: { whole: 'aaaaaa' } },
      cols: { [K(1)]: { style: 'bbbbbb' } },
      rows: { [R(1)]: { style: 'cccccc' } },
      cells: { [R(1)]: { [K(1)]: 'dddddd' } },
      conditional: { c1: { order: 1, type: 'blank', ranges: [{ col: K(1) }], style: 'aaaaaa' } },
    };
    const names = resolve(sheet, table, R(1), K(1), { conditional: () => [{ fill: 'amber' }] }).layers.map(
      (l) => l.name,
    );
    expect([...names, 'run marks']).toEqual(expected);
  });
});

describe('looks and hooks', () => {
  afterEach(() => setConditionalLayer(null));

  it('picks the look elements of a cell: banding, emphasis, header, and total', () => {
    const table = makeTable(range(1, 4), range(1, 3), true);
    const sheet: Sheet = { table: { band: { rows: true }, emphasis: { firstCol: true, totalRow: true } } };
    expect(lookElements(sheet, table, 0, 0)).toEqual(['whole', 'firstCol', 'header']);
    expect(lookElements(sheet, table, 1, 1)).toEqual(['whole', 'band1']);
    expect(lookElements(sheet, table, 2, 1)).toEqual(['whole', 'band2']);
    expect(lookElements(sheet, table, 3, 2)).toEqual(['whole', 'total']);
  });

  it('draws a look object from the style sheet and a look name through the theme', () => {
    const table = makeTable(range(1, 2), range(1, 2), true);
    const object: Sheet = { styles: { hhhhhh: { font: { bold: true } } }, table: { look: { header: 'hhhhhh' } } };
    expect(resolve(object, table, R(1), K(1)).style.font?.bold).toBe(true);
    expect(resolve(object, table, R(2), K(1)).style.font?.bold).toBeUndefined();
    const named: Sheet = { table: { look: 'banded-indigo' } };
    const namedLook = (look: string, element: string) => (element === 'header' ? { fill: look.slice(7) } : undefined);
    expect(resolve(named, table, R(1), K(1), { namedLook }).style.fill).toBe('indigo');
    expect(resolve(named, table, R(1), K(1)).style.fill).toBeUndefined();
  });

  it('layers conditional formats from the registered hook above the cell style', () => {
    const table = makeTable(range(1, 2), range(1, 2));
    const sheet: Sheet = {
      styles: { dddddd: { fill: 'plum', font: { italic: true } } },
      cells: { [R(1)]: { [K(1)]: 'dddddd' } },
      conditional: { c1: { order: 1, type: 'blank', ranges: [{ row: R(1) }], style: 'dddddd' } },
    };
    setConditionalLayer((rules) => rules.map(() => ({ fill: 'brick' })));
    expect(resolve(sheet, table, R(1), K(1)).style).toMatchObject({ fill: 'brick', font: { italic: true } });
    expect(resolve(sheet, table, R(2), K(1)).style.fill).toBeUndefined();
  });

  it('takes the number format from the column type only where no layer sets one', () => {
    const table = makeTable(range(1, 1), range(1, 2));
    const sheet: Sheet = { styles: { ffffff: { fmt: '0.0%' } }, cols: { [K(2)]: { style: 'ffffff' } } };
    const columnFormat = () => '#,##0.00';
    expect(resolve(sheet, table, R(1), K(1), { columnFormat }).style.fmt).toBe('#,##0.00');
    expect(resolve(sheet, table, R(1), K(2), { columnFormat }).style.fmt).toBe('0.0%');
  });
});
