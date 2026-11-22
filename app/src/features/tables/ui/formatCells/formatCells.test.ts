// The Format Cells dialog's logic: the number codes each choice writes, the custom code check with its error position,
// the preview, what OK writes (only changed properties), and the Border tab's edges. Expected values are worked by
// hand from ECMA-376 18.8.31 (the number format grammar and the built-in IDs 7, 8, and 44) and the style model.
// checks-disable-file brand-consistency: cell colors here are document data of the file format, not interface styling
import { describe, expect, it } from 'vitest';
import { EN_US } from '../../engine/locale';
import { applyToRange, styleById } from '../../sheet/model';
import type { Sheet } from '../../sheet/model';
import { writeSteps } from '../../sheet/formatTarget';
import type { TableData } from '../../../../editor/schema/specs';
import { applyMergePatch } from '../../../../platform/mergePatch';
import { K, makeTable, R, range } from '../../sheet/model/testing';
import { styleDiff, withFormat, withProp } from './draft';
import { edgeSteps, edgesOf, presetEdges } from './edges';
import { categoryOf, checkCode, codeFor, DEFAULT_OPTIONS, previewCode, sampleOf } from './numberCodes';
import { marksFor } from './open';

const opts = (more: Partial<typeof DEFAULT_OPTIONS>) => ({ ...DEFAULT_OPTIONS, ...more });

describe('the Number tab codes', () => {
  it('writes the codes of the built-in formats of ECMA-376 18.8.30', () => {
    expect(codeFor('number', opts({ decimals: 2, thousands: false }), EN_US)).toBe('0.00'); // ID 2
    expect(codeFor('number', opts({ decimals: 2, thousands: true }), EN_US)).toBe('#,##0.00'); // ID 4
    expect(codeFor('number', opts({ decimals: 0, thousands: true }), EN_US)).toBe('#,##0'); // ID 3
    expect(codeFor('percent', opts({ decimals: 0 }), EN_US)).toBe('0%'); // ID 9
    expect(codeFor('percent', opts({ decimals: 2 }), EN_US)).toBe('0.00%'); // ID 10
    expect(codeFor('scientific', opts({ decimals: 2 }), EN_US)).toBe('0.00E+00'); // ID 11
    expect(codeFor('fraction', opts({ pattern: 0 }), EN_US)).toBe('# ?/?'); // ID 12
    expect(codeFor('fraction', opts({ pattern: 1 }), EN_US)).toBe('# ??/??'); // ID 13
    expect(codeFor('text', DEFAULT_OPTIONS, EN_US)).toBe('@'); // ID 49
    expect(codeFor('general', DEFAULT_OPTIONS, EN_US)).toBeNull();
  });

  it('writes the currency forms of IDs 7 and 8, and the accounting form of ID 44', () => {
    expect(codeFor('currency', opts({ symbol: '$', negative: 'paren' }), EN_US)).toBe('"$"#,##0.00_);("$"#,##0.00)');
    expect(codeFor('currency', opts({ symbol: '$', negative: 'redParen' }), EN_US)).toBe(
      '"$"#,##0.00_);[Red]("$"#,##0.00)',
    );
    expect(codeFor('accounting', opts({ symbol: '$' }), EN_US)).toBe(
      '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)',
    );
  });

  it('writes decimals and negatives', () => {
    expect(codeFor('number', opts({ decimals: 3, negative: 'red' }), EN_US)).toBe('0.000;[Red]-0.000');
    expect(codeFor('number', opts({ decimals: 1, negative: 'paren' }), EN_US)).toBe('0.0_);(0.0)');
    expect(codeFor('number', opts({ decimals: 99 }), EN_US)).toBe(`0.${'0'.repeat(30)}`);
  });

  it('reads a code back as the category and options that write it, or as Custom', () => {
    for (const [category, o] of [
      ['number', opts({ decimals: 3, thousands: true, negative: 'redParen' })],
      ['currency', opts({ symbol: '€', decimals: 0, negative: 'red' })],
      ['accounting', opts({ symbol: '$', decimals: 2 })],
      ['percent', opts({ decimals: 1 })],
      ['scientific', opts({ decimals: 4 })],
      ['date', opts({ pattern: 2 })],
      ['time', opts({ pattern: 4 })],
      ['fraction', opts({ pattern: 6 })],
      ['special', opts({ pattern: 2 })],
    ] as const) {
      const code = codeFor(category, o, EN_US) ?? '';
      const back = categoryOf(code, EN_US);
      expect(back.category, code).toBe(category);
      expect(codeFor(back.category, back.options, EN_US), code).toBe(code);
    }
    expect(categoryOf(undefined, EN_US).category).toBe('general');
    expect(categoryOf('0.00"x"', EN_US).category).toBe('custom');
    expect(categoryOf('[Blue]0.0', EN_US).category).toBe('custom');
  });
});

describe('the custom code check and the preview', () => {
  it('previews 0.00"x" on 2 as 2.00x', () => {
    expect(checkCode('0.00"x"', EN_US)).toEqual({ ok: true, code: '0.00"x"' });
    expect(previewCode('0.00"x"', 2, EN_US)).toBe('2.00x');
  });

  it('shows the position of an unbalanced quote', () => {
    const bad = checkCode('0.00"x', EN_US);
    expect(bad).toMatchObject({ ok: false, error: 'quote', at: 4 });
    expect(previewCode('0.00"x', 2, EN_US)).toBeNull();
  });

  it('shows the position of an unclosed bracket, a dangling backslash, and a fifth section', () => {
    expect(checkCode('0.0 [Red', EN_US)).toMatchObject({ ok: false, error: 'bracket', at: 4 });
    expect(checkCode('0.0\\', EN_US)).toMatchObject({ ok: false, error: 'escape', at: 3 });
    expect(checkCode('0;0;0;@;0', EN_US)).toMatchObject({ ok: false, error: 'sections', at: 7 });
  });

  it('keeps a quote that is closed or inside a bracket from being a problem', () => {
    expect(checkCode('"a;b"0', EN_US).ok).toBe(true);
    expect(checkCode('[$-409]0.0', EN_US).ok).toBe(true);
  });

  it('reads a code typed with the region separators', () => {
    const german = { ...EN_US, tag: 'de-DE', decimal: ',' as const, group: '.', list: ';' as const };
    expect(checkCode('#.##0,00', german)).toEqual({ ok: true, code: '#,##0.00' });
  });

  it('previews dates, percents, and the cell number as the sample', () => {
    expect(previewCode('0.00%', 0.256, EN_US)).toBe('25.60%');
    expect(previewCode('yyyy-mm-dd', 45292, EN_US)).toBe('2024-01-01');
    expect(sampleOf('42')).toBe(42);
    expect(sampleOf('text')).toBe(1234.5678);
    expect(sampleOf('')).toBe(1234.5678);
  });
});

describe('what OK writes', () => {
  it('writes only the properties that changed', () => {
    const before = { fmt: '0.0', font: { bold: true, size: 12 }, fill: '#fde68a', align: { h: 'left' as const } };
    const after = withProp(withFormat(before, '0.00'), 'font', 'size', 14);
    expect(styleDiff(before, after)).toEqual({ fmt: '0.00', font: { size: 14 } });
    expect(styleDiff(before, before)).toBeNull();
  });

  it('writes null for a property that was removed', () => {
    const before = { font: { bold: true, italic: true }, fill: '#fde68a' };
    const after = withProp({ ...before, fill: undefined }, 'font', 'italic', undefined);
    delete (after as { fill?: unknown }).fill;
    expect(styleDiff(before, after)).toEqual({ fill: null, font: { italic: null } });
  });

  it('removes the group when its last property goes', () => {
    expect(withProp({ font: { bold: true } }, 'font', 'bold', undefined)).toEqual({});
  });

  it('names the text marks that a changed font property replaces', () => {
    expect(marksFor({ font: { bold: true, color: '#fff' } })).toEqual(['bold', 'weight', 'textColor']);
    expect(marksFor({ fmt: '0' })).toEqual([]);
    expect(marksFor(null)).toEqual([]);
  });
});

describe('the Border tab', () => {
  const table = makeTable(range(1, 3), range(1, 3), true) as TableData;
  const one = { top: 1, left: 1, bottom: 1, right: 1 };
  const all = { top: 0, left: 0, bottom: 2, right: 2 };
  const patched = (sheet: Sheet, patch: Record<string, unknown> | null): Sheet =>
    patch ? (applyMergePatch(sheet, patch.sheet) as Sheet) : sheet;

  it('toggling the diagonal-down button on a cell writes border.dd with the chosen style', () => {
    const steps = edgeSteps(one, {}, { dd: { style: 'dashed', color: '#cc0000' } });
    expect(steps).toHaveLength(1);
    expect(steps[0].change).toEqual({ border: { dd: { style: 'dashed', color: '#cc0000' } } });
    const written = writeSteps({}, table, steps);
    const sheet = patched({}, written.patch);
    const id = (sheet.cells as Record<string, Record<string, string>>)[R(2)][K(2)];
    expect(styleById(sheet, id)).toEqual({ border: { dd: { style: 'dashed', color: '#cc0000' } } });
  });

  it('toggling it off removes the side', () => {
    const on = applyToRange({}, table, [R(2), K(2)], [R(2), K(2)], { border: { dd: { style: 'thin' } } }).sheet;
    const edges = edgesOf(on, table, one);
    expect(edges.dd).toEqual({ style: 'thin' });
    const off = writeSteps(on, table, edgeSteps(one, edges, {}));
    expect(off.sheet.cells).toBeUndefined();
  });

  it('writes only the edges that differ', () => {
    const line = { style: 'thin' };
    expect(edgeSteps(all, { t: line }, { t: line })).toEqual([]);
    expect(edgeSteps(all, {}, { t: line })).toHaveLength(1);
  });

  it('an outline writes the outer sides of the edge cells and nothing inside', () => {
    const steps = edgeSteps(all, {}, presetEdges('outline', { style: 'thin' }, all, {}));
    const sheet = writeSteps({}, table, steps).sheet;
    const side = (r: number, c: number) => {
      const id = (sheet.cells as Record<string, Record<string, string>> | undefined)?.[R(r + 1)]?.[K(c + 1)];
      return Object.keys(styleById(sheet, id)?.border ?? {})
        .sort()
        .join('');
    };
    expect(side(0, 0)).toBe('lt');
    expect(side(0, 1)).toBe('t');
    expect(side(0, 2)).toBe('rt');
    expect(side(1, 0)).toBe('l');
    expect(side(1, 1)).toBe('');
    expect(side(2, 2)).toBe('br');
  });

  it('inside lines are written on both cells that share them and need two cells', () => {
    const edges = presetEdges('inside', { style: 'thin' }, all, {});
    expect(Object.keys(edges).sort()).toEqual(['ih', 'iv']);
    expect(edgeSteps(one, {}, { ih: { style: 'thin' } })).toEqual([]);
    expect(presetEdges('inside', { style: 'thin' }, one, {})).toEqual({});
    const sheet = writeSteps({}, table, edgeSteps(all, {}, { ih: { style: 'thin' } })).sheet;
    const border = (r: number, c: number) => {
      const id = (sheet.cells as Record<string, Record<string, string>> | undefined)?.[R(r + 1)]?.[K(c + 1)];
      return styleById(sheet, id)?.border;
    };
    expect(border(0, 0)).toEqual({ b: { style: 'thin' } });
    expect(border(1, 0)).toEqual({ t: { style: 'thin' }, b: { style: 'thin' } });
    expect(border(2, 0)).toEqual({ t: { style: 'thin' } });
  });

  it('None clears every edge, diagonals included', () => {
    const line = { style: 'thin' };
    const now = { t: line, b: line, dd: line };
    const none = presetEdges('none', line, one, now);
    expect(none).toEqual({});
  });
});
