// @vitest-environment jsdom
// Paste special and text cells (DESIGN 13.7, ADR 0067). Expected values are hand-worked arithmetic, the clipboard
// formats' own cells (Excel's mso-number-format "\@" is its Text format; a Sheets value {"1":2} is a string), and
// the validation rule ranges a person would draw by hand.
import { describe, expect, it } from 'vitest';
import type { TableData } from '../../../editor/schema/specs';
import { EN_US } from '../engine/locale';
import { readClip } from '../engine/paste/clip';
import type { Clip } from '../engine/paste/clip';
import { gridOf, readSheet, resolve } from '../sheet/model';
import type { Sheet } from '../sheet/model';
import { applyPatch, type Json } from '../sheet/model/json';
import { EMPTY_SMART } from '../smart/data';
import { prepareModel } from '../smart/model';
import { copyCells } from './copy';
import { planPaste, textMarkdown, type PastePlan, type PasteTarget } from './plan';
import { boxesOf, subtract } from './rules';
import { operate, PASTE_ALL, PASTE_VALUES, type PasteSpecial } from './special';

function ids(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}${n++}`;
}

/** A table of Markdown rows; the column IDs are c0, c1, ... and the row IDs r0, r1, .... */
function tableOf(rows: string[][], header = false): TableData {
  return {
    header,
    columns: rows[0].map((_, c) => ({ id: `c${c}`, width: 160 })),
    rows: rows.map((cells, r) => ({
      id: `r${r}`,
      cells: Object.fromEntries(cells.map((markdown, c) => [`c${c}`, { markdown }])),
    })),
  };
}

const texts = (table: TableData): string[][] =>
  table.rows.map((row) => table.columns.map((column) => row.cells[column.id]?.markdown ?? ''));

const AT_A1 = { top: 0, left: 0, bottom: 0, right: 0 };

function paste(target: Partial<PasteTarget> & { table: TableData }, clip: Clip | null, special: PasteSpecial) {
  if (!clip) throw new Error('no clip');
  const plan = planPaste({ sheet: {}, box: AT_A1, ...target }, clip, special, { newId: ids('n'), now: 'T' });
  if (!plan) throw new Error('no plan');
  return plan;
}

/** The sheet after the plan's patch (a block data patch of `sheet`). */
const sheetAfter = (before: Sheet, plan: PastePlan): Sheet =>
  readSheet(
    plan.patch
      ? (applyPatch({ sheet: before } as Json, plan.patch as Json) as Record<string, unknown>)
      : { sheet: before },
  );

const cellStyle = (table: TableData, sheet: Sheet, r: number, c: number) => {
  const grid = gridOf(table);
  return resolve(readSheet({ sheet }), table, grid.rows[r], grid.cols[c]).layers.find((l) => l.name === 'cell')?.style;
};

describe('text cells (G7)', () => {
  // Excel writes its Text format as mso-number-format:"\@" in a class rule.
  const EXCEL_TEXT =
    '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">' +
    '<head><meta name=ProgId content=Excel.Sheet><style>.xl65{mso-number-format:"\\@";}</style></head><body>' +
    '<table><tr><td class=xl65>=abc</td><td x:num>5</td></tr></table></body></html>';

  it('keeps an Excel text cell "=abc" as text with the "@" format, which the engine never reads as a formula', () => {
    const table = tableOf([['', '']]);
    const plan = paste({ table }, readClip({ html: EXCEL_TEXT }), PASTE_ALL);
    expect(texts(plan.table)).toEqual([['=abc', '5']]);
    expect(plan.report).not.toContain('equalsText');
    const sheet = sheetAfter({}, plan);
    expect(cellStyle(plan.table, sheet, 0, 0)).toEqual({ fmt: '@' });
    // A cell with the "@" format keeps even a formula that would compute (=1+1) as its text.
    const grid = { header: false, columnIds: ['c0', 'c1'], texts: [['=1+1', '5']] };
    const read = prepareModel({ ...grid, rowIds: ['r0'] }, EMPTY_SMART, EN_US, sheet).raw.rows[0].cells;
    expect(read[0].formula).toBeUndefined();
    expect(read[0].raw).toBe('=1+1');
    // The same text in a cell without the format is a formula, as typed text is.
    expect(prepareModel(grid, EMPTY_SMART, EN_US, {}).raw.rows[0].cells[0].formula).toBeDefined();
  });

  it('keeps a Sheets string value "=abc" as text on a values paste', () => {
    const html =
      '<google-sheets-html-origin><table><tr>' +
      '<td data-sheets-value="{&quot;1&quot;:2,&quot;2&quot;:&quot;=abc&quot;}">=abc</td></tr></table>';
    const table = tableOf([['']]);
    const plan = paste({ table }, readClip({ html }), PASTE_VALUES);
    expect(texts(plan.table)).toEqual([['=abc']]);
    expect(cellStyle(plan.table, sheetAfter({}, plan), 0, 0)).toEqual({ fmt: '@' });
  });

  it('still announces text that starts with "=" when the source does not mark it as text', () => {
    const plan = paste({ table: tableOf([['', '']]) }, readClip({ text: '=abc\tx' }), PASTE_VALUES);
    expect(plan.report).toContain('equalsText');
  });
});

describe('validation rules (G6b)', () => {
  const RULE = { kind: 'list', items: ['Yes', 'No'], alert: 'stop' };

  function copied(page = 'p1') {
    const table = tableOf([
      ['a', 'Yes'],
      ['b', 'No'],
    ]);
    const sheet: Sheet = { validation: { v1: { ranges: [{ from: ['r0', 'c1'], to: ['r1', 'c1'] }], ...RULE } } };
    return copyCells({ table, sheet, box: { top: 0, left: 0, bottom: 1, right: 1 }, locale: EN_US, block: 'b1', page });
  }

  it('copies each rule once, without its ranges, and names it from the cells it covers', () => {
    const out = copied();
    expect(out.own.rules).toEqual([RULE]);
    expect(out.own.rows.map((row) => row.map((cell) => cell.r))).toEqual([
      [undefined, 0],
      [undefined, 0],
    ]);
  });

  it('gives the pasted cells the rule and takes them out of the rule that covered them, on the same page', () => {
    const table = tableOf([
      ['', ''],
      ['', ''],
      ['', ''],
      ['', ''],
    ]);
    const before: Sheet = { validation: { v1: { ranges: [{ col: 'c0' }], kind: 'whole', alert: 'stop' } } };
    const plan = paste({ table, sheet: before, block: 'b2', page: 'p1' }, readClip({ html: copied().html }), PASTE_ALL);
    expect(plan.report).not.toContain('validation');
    const validation = sheetAfter(before, plan).validation as Record<string, { ranges: unknown }>;
    // Column A keeps its rule below the pasted rows (rows 3 and 4); B1:B2 get the copied list rule.
    expect(validation.v1.ranges).toEqual([{ from: ['r2', 'c0'], to: ['r3', 'c0'] }]);
    expect(validation.v2).toEqual({ ...RULE, ranges: [{ from: ['r0', 'c1'], to: ['r1', 'c1'] }] });
  });

  it('pastes only the rules with the Validation choice', () => {
    const table = tableOf([
      ['x', 'y'],
      ['', ''],
    ]);
    const plan = paste({ table, block: 'b2', page: 'p1' }, readClip({ html: copied().html }), {
      ...PASTE_ALL,
      what: 'validation',
    });
    expect(texts(plan.table)).toEqual([
      ['x', 'y'],
      ['', ''],
    ]);
    const validation = sheetAfter({}, plan).validation as Record<string, unknown>;
    expect(Object.keys(validation)).toEqual(['v1']);
  });

  it('leaves the rules out, and says so, for a copy from another page', () => {
    const table = tableOf([
      ['', ''],
      ['', ''],
    ]);
    const plan = paste({ table, block: 'b2', page: 'p9' }, readClip({ html: copied().html }), PASTE_ALL);
    expect(plan.report).toContain('validation');
    expect(sheetAfter({}, plan).validation).toBeUndefined();
  });

  it('covers cells with the fewest boxes and cuts a box around a pasted area', () => {
    const cells = [
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 1, col: 0 },
      { row: 1, col: 1 },
      { row: 2, col: 1 },
    ];
    expect(boxesOf(cells)).toEqual([
      { top: 0, bottom: 1, left: 0, right: 1 },
      { top: 2, bottom: 2, left: 1, right: 1 },
    ]);
    // A 3 by 3 box minus its center leaves the top row, the bottom row, and the middle row's two ends.
    expect(subtract({ top: 0, bottom: 2, left: 0, right: 2 }, { top: 1, bottom: 1, left: 1, right: 1 })).toEqual([
      { top: 0, bottom: 0, left: 0, right: 2 },
      { top: 2, bottom: 2, left: 0, right: 2 },
      { top: 1, bottom: 1, left: 0, right: 0 },
      { top: 1, bottom: 1, left: 2, right: 2 },
    ]);
  });
});

describe('operations (G10)', () => {
  const target = () => tableOf([['10', '20', '7']]);
  const clip = () => readClip({ text: '4\t5\t0' });

  it('subtracts, multiplies, and divides the pasted numbers into the cells', () => {
    const op = (operation: PasteSpecial['operation']) =>
      texts(paste({ table: target() }, clip(), { ...PASTE_VALUES, operation }).table)[0];
    expect(op('subtract')).toEqual(['6', '15', '7']);
    expect(op('multiply')).toEqual(['40', '100', '0']);
    expect(op('divide')).toEqual(['2.5', '4', textMarkdown('#DIV/0!')]);
  });

  it('gives null for a division by zero, and the paste announces it', () => {
    expect(operate('divide', 7, 0)).toBeNull();
    // 0.3 - 0.1 is 0.19999999999999998 in binary; 15 significant digits show 0.2.
    expect(operate('subtract', 0.3, 0.1)).toBe(0.2);
    const plan = paste({ table: target() }, clip(), { ...PASTE_VALUES, operation: 'divide' });
    expect(plan.report).toContain('divide');
    const fine = paste({ table: target() }, readClip({ text: '4\t5\t1' }), { ...PASTE_VALUES, operation: 'divide' });
    expect(fine.report).not.toContain('divide');
  });
});

describe('paste link (G10)', () => {
  const LINK: PasteSpecial = { ...PASTE_ALL, link: true };
  const source = () =>
    readClip({
      html: copyCells({
        table: tableOf([['1'], ['2']]),
        sheet: {},
        box: { top: 0, left: 0, bottom: 1, right: 0 },
        locale: EN_US,
        block: 'b1',
        name: 'Sales',
        page: 'p1',
      }).html,
    });

  it('writes =A1 within the same table', () => {
    const table = tableOf([
      ['1', ''],
      ['2', ''],
    ]);
    const plan = paste(
      { table, box: { top: 0, left: 1, bottom: 0, right: 1 }, block: 'b1', page: 'p1' },
      source(),
      LINK,
    );
    expect(texts(plan.table)).toEqual([
      ['1', '=A1'],
      ['2', '=A2'],
    ]);
  });

  it('writes =Sales!A1 in another table on the same page', () => {
    const plan = paste({ table: tableOf([[''], ['']]), block: 'b2', page: 'p1' }, source(), LINK);
    expect(texts(plan.table)).toEqual([['=Sales!A1'], ['=Sales!A2']]);
  });

  it('refuses a link to a table on another page', () => {
    const plan = paste({ table: tableOf([[''], ['']]), block: 'b2', page: 'p2' }, source(), LINK);
    expect(plan.report).toContain('link');
    expect(texts(plan.table)).toEqual([[''], ['']]);
  });
});
