// Named cell styles, the looks writer, and the format painter, on small tables with readable IDs. Expected values are
// worked by hand from the rules in DESIGN 3.3 and 3.5: a cell holds one style ID, and a style change moves every use.
// checks-disable-file brand-consistency: cell colors here are document data of the file format, not interface styling
import { describe, expect, it } from 'vitest';
import { applyToRange, applyToColumns, resolve, styleById, validStyle } from '../../sheet/model';
import type { CellStyle, Sheet } from '../../sheet/model';
import { applyMergePatch } from '../../../../platform/mergePatch';
import { K, makeTable, R, range } from '../../sheet/model/testing';
import {
  BUILTIN_KEYS,
  BUILTIN_STYLES,
  applyStyle,
  changeNamed,
  freeName,
  listStyles,
  removeNamed,
  usesOf,
} from './named';
import { paint } from './painter';
import { lookOf, setLook } from './tableLook';

const table = makeTable(range(1, 5), range(1, 5));
/** The style ID a cell holds, by zero-based position. */
const idAt = (sheet: Sheet, row: number, col: number): string | undefined =>
  ((sheet.cells as Record<string, Record<string, string>> | undefined)?.[R(row + 1)] ?? {})[K(col + 1)];
const styleAtCell = (sheet: Sheet, row: number, col: number): CellStyle =>
  styleById(sheet, idAt(sheet, row, col)) ?? {};
const apply = (sheet: Sheet, patch: Record<string, unknown> | null): Sheet =>
  patch ? (applyMergePatch(sheet, patch.sheet) as Sheet) : sheet;

describe('named styles', () => {
  it('offers the ten styles of the list and six accents', () => {
    expect(BUILTIN_KEYS).toEqual([
      'normal',
      'heading',
      'total',
      'input',
      'output',
      'note',
      'good',
      'bad',
      'neutral',
      'warning',
      'accent1',
      'accent2',
      'accent3',
      'accent4',
      'accent5',
      'accent6',
    ]);
    // Every definition is a valid cell style, so the model reads all of it.
    for (const key of BUILTIN_KEYS) expect(validStyle(BUILTIN_STYLES[key] as never), key).toEqual(BUILTIN_STYLES[key]);
  });

  it('applies a style to a box and stores the style once', () => {
    const done = applyStyle({}, table, { top: 1, left: 1, bottom: 2, right: 2 }, 'good');
    const sheet = apply({}, done.patch);
    const ids = new Set([idAt(sheet, 1, 1), idAt(sheet, 1, 2), idAt(sheet, 2, 1), idAt(sheet, 2, 2)]);
    expect(ids.size).toBe(1);
    expect(styleAtCell(sheet, 1, 1)).toEqual(BUILTIN_STYLES.good);
    expect(idAt(sheet, 0, 0)).toBeUndefined();
    expect(usesOf(sheet, 'good')).toBe(4);
  });

  it('replaces the formatting a cell had, as applying a style does', () => {
    const bold = applyToRange({}, table, [R(1), K(1)], [R(1), K(1)], { font: { bold: true }, fmt: '0.00' }).sheet;
    const sheet = apply(bold, applyStyle(bold, table, { top: 0, left: 0, bottom: 0, right: 0 }, 'bad').patch);
    expect(styleAtCell(sheet, 0, 0)).toEqual(BUILTIN_STYLES.bad);
  });
});

describe('changing a named style', () => {
  it('a cell with direct formatting on top of the style still follows it', () => {
    const base = apply({}, applyStyle({}, table, { top: 0, left: 0, bottom: 0, right: 1 }, 'good').patch);
    const direct = applyToRange(base, table, [R(1), K(2)], [R(1), K(2)], { fmt: '0.00', font: { italic: true } }).sheet;
    expect(usesOf(direct, 'good')).toBe(2);
    const after = apply(direct, changeNamed(direct, table, 'good', { fill: '#c0ffee' }).patch);
    expect(styleAtCell(after, 0, 0).fill).toBe('#c0ffee');
    const kept = styleAtCell(after, 0, 1);
    expect(kept.fill).toBe('#c0ffee');
    expect(kept.fmt).toBe('0.00');
    expect(kept.font?.italic).toBe(true);
    expect(kept.font?.color).toBe('#1f5a1a');
  });

  it("changing the Good style's fill updates every cell using it in one patch", () => {
    const first = applyStyle({}, table, { top: 0, left: 0, bottom: 1, right: 1 }, 'good');
    const used = apply({}, first.patch);
    // A second box with the same style, set apart, and a cell that does not use it.
    const more = apply(used, applyStyle(used, table, { top: 3, left: 3, bottom: 3, right: 3 }, 'good').patch);
    const other = apply(more, applyStyle(more, table, { top: 4, left: 0, bottom: 4, right: 0 }, 'bad').patch);
    expect(usesOf(other, 'good')).toBe(5);
    const changed = changeNamed(other, table, 'good', { fill: '#c0ffee' });
    expect(changed.patch).not.toBeNull();
    const after = apply(other, changed.patch);
    for (const [r, c] of [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
      [3, 3],
    ]) {
      expect(styleAtCell(after, r, c).fill, `${r},${c}`).toBe('#c0ffee');
      expect(styleAtCell(after, r, c).font?.color).toBe('#1f5a1a');
    }
    // The Bad cell is untouched, and the old Good style left the style sheet (no cell holds it).
    expect(styleAtCell(after, 4, 0)).toEqual(BUILTIN_STYLES.bad);
    expect(usesOf(after, 'good')).toBe(5);
    expect(Object.values(after.styles as Record<string, CellStyle>).filter((s) => s.fill === '#d9efd5')).toHaveLength(
      0,
    );
    // The patch is one merge patch of the block's data: one Undo step. Its inverse takes everything back.
    expect(Object.keys(changed.patch as object)).toEqual(['sheet']);
  });

  it('returns a changed built-in style to its original and moves the cells back', () => {
    const used = apply({}, applyStyle({}, table, { top: 0, left: 0, bottom: 0, right: 1 }, 'good').patch);
    const changed = apply(used, changeNamed(used, table, 'good', { fill: '#c0ffee' }).patch);
    expect((changed.named as Record<string, unknown>).good).toBeDefined();
    const reverted = apply(changed, removeNamed(changed, table, 'good').patch);
    expect(reverted.named).toBeUndefined();
    expect(styleAtCell(reverted, 0, 1)).toEqual(BUILTIN_STYLES.good);
  });

  it('defines a custom style and removing it leaves the cells formatted', () => {
    const custom = { fill: '#aabbcc', font: { italic: true } } as CellStyle;
    const sheet: Sheet = { named: { 'Lab result': custom as never } };
    expect(listStyles(sheet).at(-1)).toMatchObject({ key: 'Lab result', builtin: false, stored: true });
    const used = apply(sheet, applyStyle(sheet, table, { top: 0, left: 0, bottom: 0, right: 0 }, 'Lab result').patch);
    expect(usesOf(used, 'Lab result')).toBe(1);
    const removed = apply(used, removeNamed(used, table, 'Lab result').patch);
    expect(removed.named).toBeUndefined();
    expect(styleAtCell(removed, 0, 0)).toEqual(custom);
  });

  it('names a new style by the first free name, and refuses names that shadow object keys', () => {
    const sheet: Sheet = { named: { 'My style': { font: { bold: true } } } };
    expect(freeName(sheet, 'My style')).toBe('My style 2');
    expect(freeName(sheet, 'Other')).toBe('Other');
    expect(changeNamed(sheet, table, '__proto__', {}).patch).toBeNull();
  });

  it('keeps a style used by a column when the style changes', () => {
    const column = applyToColumns({}, table, [K(2)], BUILTIN_STYLES.input as never).sheet;
    expect(usesOf(column, 'input')).toBe(1);
    const after = apply(column, changeNamed(column, table, 'input', { fill: '#112233' }).patch);
    expect(resolve(after, table, R(3), K(2)).style.fill).toBe('#112233');
  });
});

describe('the table looks writer', () => {
  it('writes the look, the banding, and the emphasis, and reads them back', () => {
    const options = {
      look: 'medium-indigo',
      band: { rows: true, cols: false },
      emphasis: { firstCol: true, lastCol: false, totalRow: true },
    };
    const done = setLook({}, options);
    expect(done.sheet).toEqual({
      table: { look: 'medium-indigo', band: { rows: true }, emphasis: { firstCol: true, totalRow: true } },
    });
    expect(lookOf(done.sheet)).toEqual(options);
    expect(done.patch).toEqual({ sheet: done.sheet });
  });

  it('removes what is turned off and the table object when nothing is left', () => {
    const on = setLook(
      {},
      {
        look: 'dark-fern',
        band: { rows: true, cols: true },
        emphasis: { firstCol: false, lastCol: false, totalRow: false },
      },
    ).sheet;
    const off = setLook(on, {
      look: null,
      band: { rows: false, cols: false },
      emphasis: { firstCol: false, lastCol: false, totalRow: false },
    });
    expect(off.sheet).toEqual({});
    expect(off.patch).toEqual({ sheet: null });
  });

  it('writes nothing when nothing changes', () => {
    const options = lookOf({});
    expect(setLook({}, options).patch).toBeNull();
  });
});

describe('the format painter', () => {
  it("copies B2's style to D2:E3 and nothing else", () => {
    const styled = applyToRange({}, table, [R(2), K(2)], [R(2), K(2)], {
      fill: '#ffee99',
      font: { bold: true },
      fmt: '0.0',
    }).sheet;
    // Cells that already have other formatting lose it where they are painted.
    const other = applyToRange(styled, table, [R(2), K(4)], [R(2), K(4)], { font: { italic: true } }).sheet;
    const outside = applyToRange(other, table, [R(5), K(1)], [R(5), K(1)], { font: { underline: 'single' } }).sheet;
    const done = paint(outside, table, { row: 1, col: 1 }, { top: 1, left: 3, bottom: 2, right: 4 });
    expect(done.patch).not.toBeNull();
    const after = done.sheet;
    for (const [r, c] of [
      [1, 3],
      [1, 4],
      [2, 3],
      [2, 4],
    ]) {
      expect(styleAtCell(after, r, c), `${r},${c}`).toEqual(styleAtCell(styled, 1, 1));
    }
    // Everything else is as it was: B2 itself, the other formatted cell, and the cell outside the target.
    expect(idAt(after, 1, 1)).toBe(idAt(outside, 1, 1));
    expect(idAt(after, 4, 0)).toBe(idAt(outside, 4, 0));
    expect(idAt(after, 0, 0)).toBeUndefined();
    expect(idAt(after, 1, 2)).toBeUndefined();
  });

  it('copies what a column style gives the source cell, and clears what the target had', () => {
    const column = applyToColumns({}, table, [K(1)], { font: { bold: true } }).sheet;
    const target = applyToRange(column, table, [R(3), K(3)], [R(3), K(3)], { fill: '#123456' }).sheet;
    const done = paint(target, table, { row: 0, col: 0 }, { top: 2, left: 2, bottom: 2, right: 2 });
    expect(styleAtCell(done.sheet, 2, 2)).toEqual({ font: { bold: true } });
  });

  it('removes the style of a target cell when the source has none', () => {
    const target = applyToRange({}, table, [R(3), K(3)], [R(3), K(3)], { fill: '#123456' }).sheet;
    const done = paint(target, table, { row: 0, col: 0 }, { top: 2, left: 2, bottom: 2, right: 2 });
    expect(idAt(done.sheet, 2, 2)).toBeUndefined();
    expect(done.sheet.styles).toBeUndefined();
  });
});
