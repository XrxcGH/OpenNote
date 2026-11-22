// @vitest-environment jsdom
// checks-disable-file brand-consistency: colors and sizes here are clipboard CSS for other apps or test inputs, not design values.
// The table clipboard's limits and guards (ADR 0067). They cover Excel formulas from a copy that did not begin at A1,
// the flag gate, hostile clipboard HTML, Edit mode, caps, cut, Paste special, and pasted "=" text.
// Expected values are hand-worked: 1 + 2 = 3, and the cell counts follow from the inputs.
import { afterEach, describe, expect, it } from 'vitest';
import { initFlags } from '../../../app/flags';
import type { TableData } from '../../../editor/schema/specs';
import { CLIP_COLUMNS, readClip, type Clip } from '../engine/paste/clip';
import { MAX_COLUMNS, MAX_ROWS } from '../engine/paste/infer';
import { EXCEL_STYLED } from '../engine/paste.fixtures';
import { addMerge, gridOf, intern, mergeSet, readSheet } from '../sheet/model';
import type { Sheet } from '../sheet/model';
import { applyPatch, clone, put, type Json } from '../sheet/model/json';
import { takesPaste } from './attach';
import { spreadsheetTableData } from './newTable';
import { planCut, planPaste } from './plan';
import { PASTE_ALL, PASTE_VALUES, PASTE_WHATS } from './special';

function ids(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}${n++}`;
}

function tableOf(rows: string[][], header = false): TableData {
  const columns = Array.from({ length: rows[0].length }, (_, c) => ({ id: `c${c}`, width: 160 }));
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

/** Excel's clipboard HTML for one column of three cells; the third holds `formula` showing 3. */
function excelColumn(formula: string): string {
  return (
    '<html xmlns:x="urn:schemas-microsoft-com:office:excel"><body><table>' +
    '<tr><td x:num>1</td></tr><tr><td x:num>2</td></tr>' +
    `<tr><td x:num="3" x:fmla="${formula}">3</td></tr></table></body></html>`
  );
}

afterEach(() => initFlags('dev'));

describe('Excel formulas from a copy that did not begin at A1 (G1)', () => {
  it('pastes =SUM(D10:D11) copied from D10:D12 as its value 3, and says so', () => {
    const clip = readClip({ html: excelColumn('=SUM(D10:D11)') });
    expect(clip?.rows[2][0].formula).toBeUndefined();
    expect(clip?.rows[2][0].num).toBe(3);
    expect(clip?.asValues).toBe(true);
    const data = spreadsheetTableData(excelColumn('=SUM(D10:D11)'), ids());
    expect(data && texts(data)).toEqual([['1'], ['2'], ['3']]);
    const target = { table: tableOf([[''], [''], ['']]), sheet: {}, box: { top: 0, left: 0, bottom: 0, right: 0 } };
    expect(clip && planPaste(target, clip, PASTE_ALL, { newId: ids() })?.report).toContain('asValues');
  });

  it('keeps =SUM(A1:A2) copied from A1:A3, which stays inside the copy', () => {
    const data = spreadsheetTableData(excelColumn('=SUM(A1:A2)'), ids());
    expect(data && texts(data)).toEqual([['1'], ['2'], ['=SUM(A1:A2)']]);
  });

  it('pastes an absolute reference or another sheet as the value', () => {
    for (const formula of ['=SUM($A$1:A2)', '=Sheet2!A1+A2', "='My data'!A1", '=SUM(A:A)']) {
      expect(readClip({ html: excelColumn(formula) })?.rows[2][0].formula, formula).toBeUndefined();
    }
  });
});

describe('the page paste with tables.sheetWrites off (G2)', () => {
  it('makes no sheet table, so the page reads the table as before', () => {
    initFlags('stable');
    expect(spreadsheetTableData(EXCEL_STYLED, ids())).toBeNull();
  });
});

/** Milliseconds that `run` takes. */
function timed(run: () => unknown): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}

describe('hostile clipboard HTML (G3)', () => {
  const excel = '<html xmlns:x="urn:schemas-microsoft-com:office:excel">';
  const head = `${excel}<body><table><tr>`;

  it('reads 320 KB of unclosed cells in linear time', () => {
    const html = head + '<td>x'.repeat(64_000) + '</tr></table></body></html>';
    expect(timed(() => readClip({ html }))).toBeLessThan(1_500);
  });

  it('reads a style block of 320 KB of unclosed braces in linear time', () => {
    const style = `<style>${'.a{'.repeat(107_000)}</style>`;
    const html = `<html><head>${style}</head><body><table><tr><td>1</td><td>2</td></tr></table></body></html>`;
    expect(timed(() => readClip({ html }))).toBeLessThan(1_500);
  });

  it('reads one class rule repeated 20,000 times on 2,000 cells once', () => {
    const rules = '.xl65{font-weight:700;color:red}'.repeat(20_000);
    const cells = '<tr><td class=xl65>1</td></tr>'.repeat(2_000);
    const html = `${excel}<head><style>${rules}</style></head><body><table>${cells}</table></body></html>`;
    let clip: Clip | null = null;
    expect(timed(() => (clip = readClip({ html })))).toBeLessThan(1_500);
    expect((clip as Clip | null)?.rows[0][0].style?.font?.bold).toBe(true);
  });

  it('reads the plain text instead of clipboard HTML past 2 MB', () => {
    const html = `<table><tr><td>a</td><td>b</td></tr></table>${' '.repeat(2_000_001)}`;
    expect(readClip({ html, text: 'x\ty' })?.rows[0].map((cell) => cell.text)).toEqual(['x', 'y']);
  });
});

describe('a paste with the caret in a cell (G4)', () => {
  it('leaves plain text with a line break or a tab in the cell, so the next row stays as it was', () => {
    const clip = readClip({ text: 'a\nb' });
    expect(clip).not.toBeNull();
    if (!clip) return;
    expect(takesPaste(false, 'edit', clip)).toBe(false);
    expect(takesPaste(false, null, clip)).toBe(false);
    expect(takesPaste(false, 'edit', readClip({ html: EXCEL_STYLED }) as Clip)).toBe(false);
  });

  it('pastes cells over a cell selection', () => {
    expect(takesPaste(true, 'grid', readClip({ text: 'a\nb' }) as Clip)).toBe(true);
  });
});

describe('caps (G8)', () => {
  it('reads no more columns than a pasted table may have, and says how many were left out', () => {
    expect(CLIP_COLUMNS).toBe(MAX_COLUMNS);
    const clip = readClip({ text: Array.from({ length: MAX_COLUMNS + 20 }, (_, i) => `v${i}`).join('\t') + '\n' });
    expect(clip?.rows[0]).toHaveLength(MAX_COLUMNS);
    expect(clip?.dropped).toEqual({ rows: 0, cols: 20 });
    const target = { table: tableOf([['']]), sheet: {}, box: { top: 0, left: 0, bottom: 0, right: 0 } };
    expect(clip && planPaste(target, clip, PASTE_ALL, { newId: ids() })?.report).toContain('dropped');
  });

  it('grows a table no further than the row limit', () => {
    const clip: Clip = {
      source: 'delimited',
      rows: [[{ text: 'a' }], [{ text: 'b' }], [{ text: 'c' }]],
      spans: [],
      widths: [],
    };
    const table = tableOf(Array.from({ length: MAX_ROWS - 1 }, () => ['']));
    const box = { top: MAX_ROWS - 2, left: 0, bottom: MAX_ROWS - 2, right: 0 };
    const plan = planPaste({ table, sheet: {}, box }, clip, PASTE_ALL, { newId: ids() });
    expect(plan?.table.rows).toHaveLength(MAX_ROWS);
    expect(plan?.report).toContain('dropped');
  });
});

describe('cut (G9)', () => {
  it('clears the text, styles, notes, and merges of the cut cells and leaves the rest', () => {
    const table = tableOf([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ]);
    const sheet: Sheet = {};
    const bold = intern(sheet, { font: { bold: true } });
    put(sheet, 'cells', { r0: { c0: bold, c2: bold } });
    put(sheet, 'notes', { r0: { c0: { markdown: 'note', at: '2026-01-01T00:00:00Z' } } });
    const grid = gridOf(table);
    addMerge(sheet, table, [grid.rows[0], grid.cols[0]], [grid.rows[1], grid.cols[1]], mergeSet(sheet, table));
    const cut = planCut(table, sheet, { top: 0, left: 0, bottom: 1, right: 1 });
    expect(texts(cut.table)).toEqual([
      ['', '', 'c'],
      ['', '', 'f'],
    ]);
    const patched = applyPatch({ sheet: clone(sheet) } as Json, cut.patch as Json) as { sheet?: unknown };
    const after = readSheet({ ...cut.table, sheet: patched.sheet });
    expect(after.notes).toBeUndefined();
    expect(mergeSet(after, cut.table).list).toHaveLength(0);
    expect(Object.keys((after.cells as Record<string, Record<string, unknown>>).r0)).toEqual(['c2']);
  });
});

describe('Paste special (G6)', () => {
  it('offers no Validation choice, since rules do not travel yet', () => {
    expect(PASTE_WHATS as readonly string[]).not.toContain('validation');
  });

  it('writes a link to another table only when the copy came from this page', () => {
    const clip: Clip = {
      source: 'opennote',
      rows: [[{ text: '5', markdown: '5' }]],
      spans: [],
      widths: [],
      link: { block: 'other', name: 'Prices', page: 'p1', top: 0, left: 1, header: false },
    };
    const target = (page: string) => ({
      table: tableOf([['']]),
      sheet: {},
      box: { top: 0, left: 0, bottom: 0, right: 0 },
      block: 'here',
      page,
    });
    const link = { ...PASTE_ALL, link: true };
    const same = planPaste(target('p1'), clip, link, { newId: ids() });
    expect(same && texts(same.table)).toEqual([['=Prices!B1']]);
    const other = planPaste(target('p2'), clip, link, { newId: ids() });
    expect(other && texts(other.table)).toEqual([['']]);
    expect(other?.report).toContain('link');
  });
});

describe('pasted values that start with "=" (G7)', () => {
  it('announces that a text value starting with "=" works as a formula', () => {
    const clip: Clip = { source: 'delimited', rows: [[{ text: '=1+1' }, { text: 'x' }]], spans: [], widths: [] };
    const target = { table: tableOf([['', '']]), sheet: {}, box: { top: 0, left: 0, bottom: 0, right: 0 } };
    expect(planPaste(target, clip, PASTE_VALUES, { newId: ids() })?.report).toContain('equalsText');
  });
});

describe('Paste values and Skip blanks (G10)', () => {
  const clip: Clip = {
    source: 'sheets',
    rows: [[{ text: '5', num: 5, formula: '=R[0]C[1]+1' }, { text: '' }]],
    spans: [],
    widths: [],
  };
  const target = () => ({
    table: tableOf([['old', 'keep']]),
    sheet: {},
    box: { top: 0, left: 0, bottom: 0, right: 0 },
  });

  it('pastes the value 5, not the formula, for Ctrl+Shift+V', () => {
    const plan = planPaste(target(), clip, PASTE_VALUES, { newId: ids() });
    expect(plan && texts(plan.table)).toEqual([['5', '']]);
  });

  it('leaves the cell under a blank one as it was with Skip blanks', () => {
    const plan = planPaste(target(), clip, { ...PASTE_VALUES, skipBlanks: true }, { newId: ids() });
    expect(plan && texts(plan.table)).toEqual([['5', 'keep']]);
  });
});
