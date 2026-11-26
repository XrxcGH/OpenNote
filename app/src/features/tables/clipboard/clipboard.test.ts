// @vitest-environment jsdom
// checks-disable-file brand-consistency: colors and sizes here are clipboard CSS for other apps or test inputs, not design values.
// Copy and paste with Excel, Google Sheets, LibreOffice, and OpenNote (ADR 0067). Expected values come from the
// fixtures' own cells (hand-written from the clipboard formats) and from hand-worked arithmetic.
import { describe, expect, it } from 'vitest';
import type { TableData } from '../../../editor/schema/specs';
import { EN_US } from '../engine/locale';
import { readClip } from '../engine/paste/clip';
import { EXCEL_STYLED, sheetsFormulaTable } from '../engine/paste.fixtures';
import { addMerge, gridOf, intern, readSheet, resolve } from '../sheet/model';
import type { Sheet } from '../sheet/model';
import { put } from '../sheet/model/json';
import { copyCells } from './copy';
import { spreadsheetTableData as spreadsheetTable } from './newTable';
import { planPaste } from './plan';
import { PASTE_ALL, PASTE_VALUES, transposeFormula } from './special';

function ids(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}${n++}`;
}

/** A table of Markdown rows; the column IDs are c0, c1, ... and the row IDs r0, r1, .... */
function tableOf(rows: string[][], header = false): TableData {
  const width = rows[0].length;
  const columns = Array.from({ length: width }, (_, c) => ({ id: `c${c}`, width: 160 }));
  return {
    header,
    columns,
    rows: rows.map((cells, r) => ({
      id: `r${r}`,
      cells: Object.fromEntries(cells.map((markdown, c) => [`c${c}`, { markdown }])),
    })),
  };
}

const texts = (table: TableData): string[][] =>
  table.rows.map((row) => table.columns.map((column) => row.cells[column.id]?.markdown ?? ''));

/** The style that draws on a cell of a table with a sheet. */
function styleOf(data: TableData & { sheet?: unknown }, r: number, c: number) {
  const sheet = readSheet(data);
  const grid = gridOf(data);
  return resolve(sheet, data, grid.rows[r], grid.cols[c]).layers.find((l) => l.name === 'cell')?.style;
}

describe('paste from Excel', () => {
  it('keeps a bold red cell, the #,##0.00 format, and =SUM(A2:A3) moved up one row for the header', () => {
    const data = spreadsheetTable(EXCEL_STYLED, ids());
    expect(data).not.toBeNull();
    if (!data) return;
    expect(data.header).toBe(true);
    expect(texts(data)).toEqual([['Amount'], ['1234.5'], ['10'], ['=SUM(A1:A2)']]);
    expect(styleOf(data, 0, 0)).toEqual({ font: { bold: true, color: '#ff0000' } });
    for (const r of [1, 2, 3]) expect(styleOf(data, r, 0)).toEqual({ fmt: '#,##0.00' });
  });

  it('pastes into a table with a header row at its first cell the same way', () => {
    const table = tableOf([['Old'], ['x']], true);
    const clip = readClip({ html: EXCEL_STYLED });
    if (!clip) throw new Error('no clip');
    const plan = planPaste({ table, sheet: {}, box: { top: 0, left: 0, bottom: 0, right: 0 } }, clip, PASTE_ALL, {
      newId: ids('n'),
    });
    expect(plan && texts(plan.table)).toEqual([['Amount'], ['1234.5'], ['10'], ['=SUM(A1:A2)']]);
  });

  it('pastes a formula lower down with its references moved by as many rows', () => {
    const table = tableOf([['T'], [''], [''], [''], ['']], true);
    const clip = readClip({ html: EXCEL_STYLED });
    if (!clip) throw new Error('no clip');
    const plan = planPaste({ table, sheet: {}, box: { top: 1, left: 0, bottom: 1, right: 0 } }, clip, PASTE_ALL, {
      newId: ids('n'),
    });
    // The clip's first row lands on A1 (grid row 1), so its fourth row, the formula, is A4 and adds A2 and A3.
    expect(plan && texts(plan.table).slice(1)).toEqual([['Amount'], ['1234.5'], ['10'], ['=SUM(A2:A3)']]);
  });
});

describe('paste from Google Sheets', () => {
  it('reads data-sheets-formula="=R[-2]C[0]+R[-1]C[0]" in A3 as =A1+A2', () => {
    const data = spreadsheetTable(sheetsFormulaTable(), ids());
    expect(data && data.header).toBe(false);
    expect(data && texts(data)).toEqual([['2'], ['3'], ['=A1+A2']]);
  });
});

describe('copy', () => {
  it('writes a merged B2:C3 with a fill as colspan, rowspan, and background-color', () => {
    const table = tableOf([
      ['a', 'b', 'c', 'd'],
      ['e', 'Merged', '', 'h'],
      ['i', '', '', 'l'],
      ['m', 'n', 'o', 'p'],
    ]);
    const sheet: Sheet = {};
    const id = intern(sheet, { fill: '#fde68a' });
    if (!id) throw new Error('no style');
    put(sheet, 'cells', { r1: { c1: id } });
    addMerge(sheet, table, ['r1', 'c1'], ['r2', 'c2']);
    const out = copyCells({ table, sheet, box: { top: 0, left: 0, bottom: 3, right: 3 }, locale: EN_US });
    const anchor = /<td[^>]*>Merged<\/td>/.exec(out.html)?.[0] ?? '';
    expect(anchor).toContain('colspan="2"');
    expect(anchor).toContain('rowspan="2"');
    expect(anchor).toContain('background-color:#fde68a');
    // Row 2 holds e, the anchor, and h; row 3 holds i and l, the covered cells being left out.
    expect(out.html.match(/<tr>(.*?)<\/tr>/g)?.map((row) => row.match(/<td/g)?.length)).toEqual([4, 3, 2, 4]);
    expect(out.text.split('\r\n')[1]).toBe('e\tMerged\t\th');
  });

  it('writes formulas for Excel and Sheets, with values, and reads its own copy back exactly', () => {
    const table = tableOf([['Qty'], ['2'], ['3'], ['=SUM(A1:A2)']], true);
    const sheet: Sheet = {};
    const out = copyCells({
      table,
      sheet,
      box: { top: 0, left: 0, bottom: 3, right: 0 },
      locale: EN_US,
      shownValue: () => 5,
    });
    expect(out.html).toContain('x:fmla="=SUM(A2:A3)"');
    expect(out.html).toContain('data-sheets-formula="=SUM(R[-2]C[0]:R[-1]C[0])"');
    expect(out.html).toContain('x:num="5"');
    expect(out.text).toBe('Qty\r\n2\r\n3\r\n5\r\n');
    const clip = readClip({ html: out.html });
    expect(clip?.source).toBe('opennote');
    const target = tableOf([['A'], ['']], true);
    const plan =
      clip &&
      planPaste({ table: target, sheet: {}, box: { top: 0, left: 0, bottom: 0, right: 0 } }, clip, PASTE_ALL, {
        newId: ids(),
      });
    expect(plan && texts(plan.table)).toEqual([['Qty'], ['2'], ['3'], ['=SUM(A1:A2)']]);
  });
});

describe('paste special', () => {
  const two = (): TableData =>
    tableOf([
      ['1', '2', '3'],
      ['4', '5', '6'],
    ]);

  it('transposes a 2 by 3 range into a 3 by 2 range', () => {
    const copied = copyCells({ table: two(), sheet: {}, box: { top: 0, left: 0, bottom: 1, right: 2 }, locale: EN_US });
    const clip = readClip({ html: copied.html });
    if (!clip) throw new Error('no clip');
    const target = tableOf([['', '', '']]);
    const plan = planPaste(
      { table: target, sheet: {}, box: { top: 0, left: 0, bottom: 0, right: 0 } },
      clip,
      { ...PASTE_ALL, transpose: true },
      { newId: ids() },
    );
    expect(plan?.box).toEqual({ top: 0, left: 0, bottom: 2, right: 1 });
    expect(plan && texts(plan.table).map((row) => row.slice(0, 2))).toEqual([
      ['1', '4'],
      ['2', '5'],
      ['3', '6'],
    ]);
  });

  it('adds pasted numbers to the numbers already there', () => {
    const clip = readClip({ text: '1\t2\t3\n4\t5\t6' });
    if (!clip) throw new Error('no clip');
    const target = tableOf([
      ['10', '20', ''],
      ['x', '=A1*2', '0.1'],
    ]);
    const plan = planPaste(
      { table: target, sheet: {}, box: { top: 0, left: 0, bottom: 0, right: 0 } },
      clip,
      { ...PASTE_VALUES, operation: 'add' },
      { newId: ids() },
    );
    // 10+1, 20+2, empty+3; text stays text; a formula gets the number added; 0.1+6 rounds to 15 digits.
    expect(plan && texts(plan.table)).toEqual([
      ['11', '22', '3'],
      ['x', '=(A1\\*2)+5', '6.1'],
    ]);
  });

  it('turns relative steps around for a transposed formula', () => {
    expect(transposeFormula('=R[-2]C[1]+R1C1+"R[3]C[4]"')).toBe('=R[1]C[-2]+R1C1+"R[3]C[4]"');
  });
});
