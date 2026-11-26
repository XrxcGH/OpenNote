// checks-disable-file brand-consistency: cell colors here are document data of the file format, not interface styling
import { afterEach, describe, expect, it } from 'vitest';
import { applyToColumns, applyToRange, applyToRows, applyToTable } from './apply';
import { applyPatch, type Json } from './json';
import { DEFAULT_STYLE, layer, lookElements, resolve } from './resolve';
import {
  applyOrder,
  RANGE_LIMIT,
  removeRule,
  RULE_LIMIT,
  rulesAt,
  rulesOf,
  setConditionalLayer,
  setRule,
} from './rules';
import { K, R, makeTable, range, specCase } from './testing';
import type { CellStyle, Sheet } from './types';

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

  it('keeps a __proto__ key from a hook style as a property, never as the prototype', () => {
    const upper = JSON.parse('{"__proto__": {"fill": "ink"}, "fill": "fern"}') as CellStyle;
    const out = layer({}, upper);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.hasOwn(out, '__proto__')).toBe(true);
    expect(out.fill).toBe('fern');
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

describe('conditional formats at scale (R-SHT-15)', () => {
  it('resolves 2,000 cells at the limit of 256 rules of 64 ranges in well under a second', () => {
    const table = makeTable(range(1, 100), range(1, 64));
    const conditional: Record<string, Json> = {};
    for (let n = 1; n <= RULE_LIMIT; n++) {
      const ranges = range(1, RANGE_LIMIT).map((c) => ({
        from: [R(1 + (n % 50)), K(c)],
        to: [R(51 + (n % 50)), K(c)],
      }));
      conditional[`c${n}`] = { order: 1 + (n % RULE_LIMIT), type: 'blank', ranges, style: 'dddddd' };
    }
    const sheet: Sheet = { styles: { dddddd: { fill: 'plum' } }, conditional };
    let seen = 0;
    const hook = (rules: readonly unknown[]) => {
      seen += rules.length;
      return [];
    };
    const start = performance.now();
    for (let r = 1; r <= 100; r++)
      for (let c = 1; c <= 20; c++) resolve(sheet, table, R(r), K(c), { conditional: hook });
    // About 2.4 s when every call read and sorted the rules again.
    expect(performance.now() - start).toBeLessThan(500);
    expect(seen).toBeGreaterThan(0);
  });

  it('sees a rule set or removed in place at once, though rules are read once per table', () => {
    const table = makeTable(range(1, 2), range(1, 2));
    const sheet: Sheet = { conditional: { c1: { order: 2, type: 'blank', ranges: [{ col: K(1) }] } } };
    expect(rulesAt(sheet, table, 'conditional', 0, 0).map((r) => r.id)).toEqual(['c1']);
    setRule(sheet, 'conditional', 'c2', { order: 1, type: 'blank', ranges: [{ row: R(1) }] });
    expect(rulesAt(sheet, table, 'conditional', 0, 0).map((r) => r.id)).toEqual(['c2', 'c1']);
    expect(applyOrder(sheet)).toEqual(['c2', 'c1']);
    removeRule(sheet, 'conditional', 'c2');
    expect(rulesAt(sheet, table, 'conditional', 0, 0).map((r) => r.id)).toEqual(['c1']);
  });

  it('finds the same rules for every cell as a check of every box', () => {
    const table = makeTable(range(1, 10), range(1, 10));
    const conditional: Record<string, Json> = {};
    let seed = 11;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return 1 + (seed % n);
    };
    for (let n = 1; n <= 40; n++) {
      const ranges = range(1, next(4)).map((): Json =>
        next(5) === 1 ? { col: K(next(10)) } : { from: [R(next(10)), K(next(10))], to: [R(next(10)), K(next(10))] },
      );
      conditional[`c${n}`] = { order: next(256), type: 'blank', ranges };
    }
    const sheet: Sheet = { conditional };
    const all = rulesOf(sheet, table, 'conditional');
    const order = applyOrder(sheet);
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 10; c++) {
        const want = all
          .filter((x) => x.boxes.some((b) => r >= b.top && r <= b.bottom && c >= b.left && c <= b.right))
          .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
          .map((x) => x.id);
        expect(
          rulesAt(sheet, table, 'conditional', r, c).map((x) => x.id),
          `${r},${c}`,
        ).toEqual(want);
      }
    }
  });
});
