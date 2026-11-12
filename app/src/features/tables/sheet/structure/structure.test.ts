// Row heights, auto-fit, hide and unhide, freeze, outline groups, and insert and delete cells (DESIGN 13.2).
// Expected values are worked out by hand from the format spec's keys (rows, cols, table.freeze) and from Excel's
// documented rules for outlines and shifting cells.
import { describe, expect, it } from 'vitest';
import type { TableData } from '../../../../editor/schema/specs';
import { applyTableOp } from '../../../../editor/commands/tables';
import { applyPatch, type Json, type JsonObject } from '../model/json';
import type { Sheet } from '../model/types';
import { deleteCells, insertCells } from './cells';
import './hooks';
import { columnPadding, distributedWidths, fitColumnWidths, fitWidth } from './fit';
import { collapse, expand, group, levelOf, showLevels, ungroup } from './outline';
import {
  distributeRows,
  freezeOf,
  hideLines,
  rowHeight,
  setFreeze,
  setRowHeight,
  unhideLines,
  visibleIndexes,
} from './lines';
import { shiftFormula } from './reflow';

function table(rows: string[][], header = false): TableData {
  const columns = rows[0].map((_, c) => ({ id: `k${c + 1}`, width: 160 }));
  return {
    header,
    columns,
    rows: rows.map((texts, r) => ({
      id: `r${r + 1}`,
      cells: Object.fromEntries(columns.map((c, i) => [c.id, { markdown: texts[i] ?? '' }])),
    })),
  };
}

const grid5 = () =>
  table(Array.from({ length: 5 }, (_, r) => Array.from({ length: 4 }, (_, c) => `${'ABCD'[c]}${r + 1}`)));

/** Applies a result's merge patch to the sheet the way the file does. */
const after = (sheet: Sheet, patch: JsonObject | null): Sheet => {
  if (!patch) return sheet;
  return ((applyPatch({ sheet } as Json, patch as Json) as JsonObject).sheet ?? {}) as Sheet;
};

describe('row heights', () => {
  it('sets an exact height, a minimum height, and clears it', () => {
    const data = grid5();
    const exact = setRowHeight({}, data, ['r2', 'r3'], 40, true);
    expect(exact.sheet.rows).toEqual({ r2: { height: 40, exact: true }, r3: { height: 40, exact: true } });
    const min = setRowHeight(exact.sheet, data, ['r2'], 55.456);
    expect(rowHeight(min.sheet, 'r2')).toEqual({ height: 55.46, exact: false });
    const cleared = setRowHeight(min.sheet, data, ['r2', 'r3'], null);
    expect(cleared.sheet).toEqual({});
    expect(cleared.patch).toEqual({ sheet: null });
  });

  it('keeps heights within 1 to 10,000', () => {
    const data = grid5();
    expect(rowHeight(setRowHeight({}, data, ['r1'], 0.2).sheet, 'r1')?.height).toBe(1);
    expect(rowHeight(setRowHeight({}, data, ['r1'], 99999).sheet, 'r1')?.height).toBe(10000);
  });

  it('distributes rows to equal heights that keep the total', () => {
    const data = grid5();
    const sheet = setRowHeight({}, data, ['r1'], 20).sheet;
    const out = distributeRows(sheet, data, 0, 2, [20, 40, 60]);
    expect(out.sheet.rows).toEqual({ r1: { height: 40 }, r2: { height: 40 }, r3: { height: 40 } });
  });

  it('runs as a table op with the caret row by default', () => {
    const change = applyTableOp(
      grid5(),
      { row: 2, column: 1 },
      { op: 'rowHeight', height: 50, exact: true },
      undefined,
    )!;
    expect(change.extra).toEqual({ sheet: { rows: { r3: { height: 50, exact: true } } } });
    expect(applyTableOp(grid5(), { row: 2, column: 1 }, { op: 'fitRows' }, undefined)).toBeNull();
  });
});

describe('auto-fit and distribute columns', () => {
  const measure = (line: string) => line.length * 7;

  it('fits a column to its longest text plus padding', () => {
    const padding = columnPadding({});
    expect(padding).toBeCloseTo(8 * (96 / 72) + 1, 1);
    const widths = fitColumnWidths(
      [
        { index: 0, texts: ['Item', 'Revenue forecast', 'Cost'] },
        { index: 1, texts: [''] },
      ],
      measure,
      padding,
    );
    // 'Revenue forecast' is 16 characters, 112 wide, so the column is 112 plus the padding.
    expect(Math.abs(widths.get(0)! - (112 + padding))).toBeLessThan(2);
    expect(widths.get(1)).toBeNull();
    expect(fitWidth(5, 0)).toBe(40);
  });

  it('runs as a table op', () => {
    const data = table([['Revenue forecast', 'x']]);
    const change = applyTableOp(
      data,
      { row: 0, column: 0 },
      { op: 'fitColumns', texts: (c) => [data.rows[0].cells[data.columns[c].id].markdown], measure },
      undefined,
    )!;
    expect(Math.abs(change.data.columns[0].width - (112 + columnPadding({})))).toBeLessThan(2);
    expect(change.data.columns[1].width).toBe(160);
  });

  it('distributes widths evenly and keeps the total', () => {
    expect(distributedWidths([100, 200, 300])).toEqual([200, 200, 200]);
    const data = table([['a', 'b', 'c']]);
    data.columns[0].width = 100;
    data.columns[1].width = 200;
    data.columns[2].width = 300;
    const change = applyTableOp(
      data,
      { row: 0, column: 0 },
      { op: 'distributeColumns', box: { row1: 0, col1: 0, row2: 0, col2: 2 } },
      undefined,
    )!;
    expect(change.data.columns.map((c) => c.width)).toEqual([200, 200, 200]);
  });
});

describe('hide and unhide', () => {
  it('hides a column and Unhide with A:C selected shows it again, keeping its data', () => {
    const data = grid5();
    const hidden = hideLines({}, data, 'cols', 1, 1);
    expect(hidden.sheet.cols).toEqual({ k2: { hidden: true } });
    expect(visibleIndexes(hidden.sheet, data, 'cols')).toEqual([0, 2, 3]);
    expect(data.rows[0].cells.k2.markdown).toBe('B1');
    const shown = unhideLines(hidden.sheet, data, 'cols', 0, 2);
    expect(shown.sheet).toEqual({});
    expect(visibleIndexes(shown.sheet, data, 'cols')).toEqual([0, 1, 2, 3]);
  });

  it('runs as table ops on the selected block', () => {
    const data = grid5();
    const box = { row1: 1, col1: 1, row2: 2, col2: 1 };
    const rows = applyTableOp(data, { row: 1, column: 1 }, { op: 'hideRows', box }, undefined)!;
    expect(rows.extra).toEqual({ sheet: { rows: { r2: { hidden: true }, r3: { hidden: true } } } });
    const stored = after({}, rows.extra as JsonObject);
    const back = applyTableOp(
      data,
      { row: 0, column: 0 },
      { op: 'unhideRows', box: { ...box, row1: 0, row2: 3 } },
      stored,
    )!;
    expect(back.extra).toEqual({ sheet: null });
    expect(applyTableOp(data, { row: 0, column: 0 }, { op: 'unhideRows' }, undefined)).toBeNull();
  });

  it('shows rows hidden by their outline too', () => {
    const data = grid5();
    const grouped = group({}, data, 'rows', 1, 2);
    const closed = collapse(grouped.sheet, data, 'rows', 3);
    expect(visibleIndexes(closed.sheet, data, 'rows')).toEqual([0, 3, 4]);
    const shown = unhideLines(closed.sheet, data, 'rows', 0, 4);
    expect(visibleIndexes(shown.sheet, data, 'rows')).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('freeze panes', () => {
  it('freezing one row stores data.sheet.table.freeze.rows as 1', () => {
    const data = grid5();
    const frozen = setFreeze({}, data, 1, 0);
    expect(frozen.sheet).toEqual({ table: { freeze: { rows: 1, cols: 0 } } });
    expect(freezeOf(frozen.sheet)).toEqual({ rows: 1, cols: 0 });
    const change = applyTableOp(data, { row: 0, column: 0 }, { op: 'freezeTopRow' }, undefined)!;
    expect(change.extra).toEqual({ sheet: { table: { freeze: { rows: 1, cols: 0 } } } });
  });

  it('freezes at the caret, clamps, and unfreezes', () => {
    const data = grid5();
    const at = applyTableOp(data, { row: 2, column: 1 }, { op: 'freezeAtCaret' }, undefined)!;
    expect(at.extra).toEqual({ sheet: { table: { freeze: { rows: 2, cols: 1 } } } });
    expect(freezeOf(setFreeze({}, data, 99, -3).sheet)).toEqual({ rows: 5, cols: 0 });
    const off = setFreeze(setFreeze({}, data, 1, 1).sheet, data, 0, 0);
    expect(off.sheet).toEqual({});
  });
});

describe('outline groups', () => {
  it('groups, nests, and ungroups', () => {
    const data = grid5();
    const one = group({}, data, 'rows', 1, 3);
    const two = group(one.sheet, data, 'rows', 2, 2);
    expect([1, 2, 3].map((i) => levelOf(two.sheet, 'rows', `r${i + 1}`))).toEqual([1, 2, 1]);
    const back = ungroup(two.sheet, data, 'rows', 1, 3);
    expect([1, 2, 3].map((i) => levelOf(back.sheet, 'rows', `r${i + 1}`))).toEqual([0, 1, 0]);
  });

  it('caps the level at 7', () => {
    let sheet: Sheet = {};
    const data = grid5();
    for (let i = 0; i < 9; i++) sheet = group(sheet, data, 'cols', 0, 0).sheet;
    expect(levelOf(sheet, 'cols', 'k1')).toBe(7);
  });

  it('collapses the group above its summary row and expands it', () => {
    const data = grid5();
    const grouped = group({}, data, 'rows', 1, 2).sheet;
    const closed = collapse(grouped, data, 'rows', 3);
    expect(closed.sheet.rows).toEqual({
      r2: { level: 1, hidden: true },
      r3: { level: 1, hidden: true },
      r4: { collapsed: true },
    });
    const open = expand(closed.sheet, data, 'rows', 3);
    expect(open.sheet.rows).toEqual({ r2: { level: 1 }, r3: { level: 1 } });
    expect(collapse(grouped, data, 'rows', 1).patch).toBeNull();
  });

  it('expanding an outer group leaves an inner collapsed group collapsed', () => {
    const data = table(Array.from({ length: 7 }, (_, r) => [`r${r}`]));
    // Rows 2..5 (index 1..4) are level 1, rows 3..4 (index 2..3) are level 2; row 6 (index 5) is the outer summary.
    let sheet = group({}, data, 'rows', 1, 4).sheet;
    sheet = group(sheet, data, 'rows', 2, 3).sheet;
    sheet = collapse(sheet, data, 'rows', 4).sheet; // inner summary is index 4 (level 1)
    sheet = collapse(sheet, data, 'rows', 5).sheet; // outer summary
    expect(visibleIndexes(sheet, data, 'rows')).toEqual([0, 5, 6]);
    sheet = expand(sheet, data, 'rows', 5).sheet;
    expect(visibleIndexes(sheet, data, 'rows')).toEqual([0, 1, 4, 5, 6]);
    sheet = expand(sheet, data, 'rows', 4).sheet;
    expect(visibleIndexes(sheet, data, 'rows')).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('the level buttons show up to the chosen level', () => {
    const data = grid5();
    let sheet = group({}, data, 'rows', 1, 2).sheet;
    sheet = group(sheet, data, 'rows', 2, 2).sheet;
    expect(visibleIndexes(showLevels(sheet, data, 'rows', 1).sheet, data, 'rows')).toEqual([0, 3, 4]);
    expect(visibleIndexes(showLevels(sheet, data, 'rows', 2).sheet, data, 'rows')).toEqual([0, 1, 3, 4]);
    expect(visibleIndexes(showLevels(sheet, data, 'rows', 3).sheet, data, 'rows')).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('insert and delete cells', () => {
  const text = (data: TableData, r: number, c: number) => data.rows[r].cells[data.columns[c].id].markdown;

  it('insert cells shifting down moves the column below the block', () => {
    const data = table([
      ['a1', 'b1'],
      ['a2', 'b2'],
      ['a3', 'b3'],
    ]);
    const out = insertCells(data, {}, { row1: 1, col1: 0, row2: 1, col2: 0 }, 'down')!.data;
    expect([0, 1, 2, 3].map((r) => text(out, r, 0))).toEqual(['a1', '', 'a2', 'a3']);
    expect([0, 1, 2, 3].map((r) => text(out, r, 1))).toEqual(['b1', 'b2', 'b3', '']);
    expect(out.rows).toHaveLength(4);
  });

  it('insert cells shifting right adds a column when content would leave the table', () => {
    const data = table([['a', 'b']]);
    const out = insertCells(data, {}, { row1: 0, col1: 0, row2: 0, col2: 0 }, 'right')!.data;
    expect(out.columns).toHaveLength(3);
    expect([0, 1, 2].map((c) => text(out, 0, c))).toEqual(['', 'a', 'b']);
  });

  it('delete cells shifting up pulls the cells below in', () => {
    const data = table([['a1'], ['a2'], ['a3'], ['a4']]);
    const out = deleteCells(data, {}, { row1: 1, col1: 0, row2: 2, col2: 0 }, 'up')!.data;
    expect([0, 1, 2, 3].map((r) => text(out, r, 0))).toEqual(['a1', 'a4', '', '']);
  });

  it('references follow the moved cells and a deleted cell reads #REF!', () => {
    const data = table([
      ['1', '=A2+A3'],
      ['2', ''],
      ['3', ''],
    ]);
    const down = insertCells(data, {}, { row1: 1, col1: 0, row2: 1, col2: 0 }, 'down')!.data;
    expect(text(down, 0, 1)).toBe('=A3+A4');
    const up = deleteCells(data, {}, { row1: 1, col1: 0, row2: 1, col2: 0 }, 'up')!.data;
    expect(text(up, 0, 1)).toBe('=#REF!+A2');
  });

  it('styles move with their cells', () => {
    const data = table([['a'], ['b'], ['c']]);
    const sheet = { styles: { s1: { font: { bold: true } } }, cells: { r2: { k1: 's1' } } } as unknown as Sheet;
    const out = insertCells(data, sheet, { row1: 0, col1: 0, row2: 0, col2: 0 }, 'down');
    const next = after(sheet, out!.patch);
    expect(next.cells).toEqual({ r3: { k1: 's1' } });
  });

  it('runs as table ops', () => {
    const data = table([['x'], ['y']]);
    const change = applyTableOp(data, { row: 0, column: 0 }, { op: 'insertCells', shift: 'down' }, undefined)!;
    expect(change.data.rows.map((r) => r.cells.k1.markdown)).toEqual(['', 'x', 'y']);
  });
});

describe('shiftFormula', () => {
  const block = { row1: 1, col1: 0, row2: Infinity, col2: 0, dRow: 2, dCol: 0 };
  it('moves cells, and grows a range that lies in the block band', () => {
    expect(shiftFormula('A1+A2+B2', block)).toBe('A1+A4+B2');
    expect(shiftFormula('SUM(A2:A3)', block)).toBe('SUM(A4:A5)');
    expect(shiftFormula('SUM(A1:A3)', block)).toBe('SUM(A1:A5)');
    expect(shiftFormula('$A$2+Other!A2', block)).toBe('$A$4+Other!A2');
  });

  it('leaves a range that only partly crosses the band', () => {
    expect(shiftFormula('SUM(B1:B3)', block)).toBe('SUM(B1:B3)');
    expect(shiftFormula('SUM(A1:B3)', block)).toBe('SUM(A1:B3)');
  });

  it('shrinks a range for delete cells and makes a fully deleted one #REF!', () => {
    const up = {
      row1: 2,
      col1: 0,
      row2: Infinity,
      col2: 0,
      dRow: -1,
      dCol: 0,
      gone: { row1: 1, col1: 0, row2: 1, col2: 0 },
    };
    expect(shiftFormula('SUM(A1:A3)', up)).toBe('SUM(A1:A2)');
    expect(shiftFormula('SUM(A2:A2)', up)).toBe('SUM(#REF!)');
  });

  it('grows and shrinks a range in the row band for right and left shifts', () => {
    const right = { row1: 0, col1: 1, row2: 0, col2: Infinity, dRow: 0, dCol: 1 };
    expect(shiftFormula('SUM(A1:C1)', right)).toBe('SUM(A1:D1)');
    expect(shiftFormula('SUM(A2:C2)', right)).toBe('SUM(A2:C2)');
    const left = {
      row1: 0,
      col1: 2,
      row2: 0,
      col2: Infinity,
      dRow: 0,
      dCol: -1,
      gone: { row1: 0, col1: 1, row2: 0, col2: 1 },
    };
    expect(shiftFormula('SUM(A1:C1)', left)).toBe('SUM(A1:B1)');
  });
});

describe('insert and delete cells under a range', () => {
  it('the sum over a column keeps every value after an insert and a delete', () => {
    const data = table([
      ['1', '=SUM(A1:A3)'],
      ['2', ''],
      ['3', ''],
    ]);
    const down = insertCells(data, {}, { row1: 1, col1: 0, row2: 1, col2: 0 }, 'down')!.data;
    expect(down.rows[0].cells.k2.markdown).toBe('=SUM(A1:A4)');
    const up = deleteCells(data, {}, { row1: 1, col1: 0, row2: 1, col2: 0 }, 'up')!.data;
    expect(up.rows[0].cells.k2.markdown).toBe('=SUM(A1:A2)');
  });
});

describe('insert cells at the edge of a table', () => {
  const blank = (n: number) => table(Array.from({ length: n }, () => Array.from({ length: n }, () => '')));
  it('does not throw in a blank table, shifting down or right', () => {
    const data = blank(3);
    expect(insertCells(data, {}, { row1: 0, col1: 0, row2: 0, col2: 0 }, 'down')!.data.rows).toHaveLength(3);
    expect(insertCells(data, {}, { row1: 0, col1: 0, row2: 0, col2: 0 }, 'right')!.data.columns).toHaveLength(3);
  });
  it('does not throw with blank rows below the used rows', () => {
    const data = table([
      ['a', 'b'],
      ['', ''],
      ['', ''],
    ]);
    const out = insertCells(data, {}, { row1: 0, col1: 0, row2: 1, col2: 0 }, 'down')!.data;
    expect(out.rows).toHaveLength(3);
    expect([0, 1, 2].map((r) => out.rows[r].cells.k1.markdown)).toEqual(['', '', 'a']);
    const wide = table([
      ['a', '', ''],
      ['b', '', ''],
    ]);
    expect(insertCells(wide, {}, { row1: 0, col1: 0, row2: 1, col2: 0 }, 'right')!.data.columns).toHaveLength(3);
  });
  it('the table commands can run on a blank table', () => {
    const data = blank(3);
    expect(applyTableOp(data, { row: 1, column: 1 }, { op: 'insertCells', shift: 'down' }, undefined)).not.toBeNull();
    expect(applyTableOp(data, { row: 1, column: 1 }, { op: 'insertCells', shift: 'right' }, undefined)).not.toBeNull();
  });
});

describe('insert and delete cells with merges', () => {
  const merged = (from: [string, string], to: [string, string]): Sheet =>
    ({ merges: { m1: { from, to } } }) as unknown as Sheet;
  it('refuses a shift that would cut a merge', () => {
    const data = table([
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
    ]);
    const sheet = merged(['r2', 'k1'], ['r3', 'k1']);
    expect(insertCells(data, sheet, { row1: 2, col1: 0, row2: 2, col2: 0 }, 'down')).toBeNull();
    expect(deleteCells(data, sheet, { row1: 2, col1: 0, row2: 2, col2: 0 }, 'up')).toBeNull();
    expect(applyTableOp(data, { row: 2, column: 0 }, { op: 'insertCells', shift: 'down' }, sheet)).toBeNull();
  });
  it('moves a merge that lies wholly in the shifted cells', () => {
    const data = table([
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
      ['', ''],
    ]);
    const sheet = merged(['r2', 'k1'], ['r3', 'k1']);
    const out = insertCells(data, sheet, { row1: 0, col1: 0, row2: 0, col2: 0 }, 'down')!;
    expect(after(sheet, out.patch).merges).toEqual({ m1: { from: ['r3', 'k1'], to: ['r4', 'k1'] } });
  });
});

describe('references between tables', () => {
  const sales = table([['10'], ['20'], ['30']]);
  const report = table([['=Sales!A2+Sales!A3', '=A1']]);
  const book = { name: 'Sales', others: [{ block: 'b2', data: report }] };

  it('inserting a row above row 2 of one table moves a qualified reference in another', () => {
    const change = applyTableOp(sales, { row: 1, column: 0 }, { op: 'rowAbove' }, undefined, book)!;
    expect(change.also).toHaveLength(1);
    expect(change.also![0].block).toBe('b2');
    const rows = change.also![0].data.rows as TableData['rows'];
    // Hand worked: Sales rows 2 and 3 move down by one, so the references read rows 3 and 4. Own references (=A1) stay.
    expect(rows[0].cells.k1.markdown).toBe('=Sales!A3+Sales!A4');
    expect(rows[0].cells.k2.markdown).toBe('=A1');
  });

  it('a qualified reference to its own table follows inside the table', () => {
    const two = table([['1'], ['2'], ['3']]);
    const mixed = {
      ...two,
      rows: [{ ...two.rows[0], cells: { k1: { markdown: '=Sales!A2' } } }, ...two.rows.slice(1)],
    };
    const change = applyTableOp(mixed, { row: 0, column: 0 }, { op: 'rowAbove' }, undefined, {
      name: 'Sales',
      others: [],
    })!;
    expect(change.data.rows.map((r) => r.cells.k1.markdown)).toContain('=Sales!A3');
  });

  it('leaves other tables alone when none reads this one', () => {
    const plain = { name: 'Sales', others: [{ block: 'b3', data: table([['=A1+B1', '2']]) }] };
    expect(applyTableOp(sales, { row: 1, column: 0 }, { op: 'rowAbove' }, undefined, plain)!.also).toBeUndefined();
  });
});

describe('the default fit text', () => {
  it('counts the shown text, not the formula or the markdown marks', async () => {
    const { shownText } = await import('./ops');
    expect(shownText('=REPT("x",50)')).toBe('');
    expect(shownText('**bold** and `code`')).toBe('bold and code');
  });
});

describe('insert and delete cells under rules', () => {
  const rule = (a: [string, string], b: [string, string], extra: object = {}): Sheet =>
    ({
      validation: { v1: { type: 'number', ranges: [{ from: a, to: b }], ...extra } },
    }) as unknown as Sheet;
  const grid = () =>
    table([
      ['1', '2'],
      ['3', '4'],
      ['5', '6'],
      ['', ''],
    ]);

  it('a rule on A1 moves to A2 when cells are inserted at A1 shifting down', () => {
    const sheet = rule(['r1', 'k1'], ['r1', 'k1']);
    const out = insertCells(grid(), sheet, { row1: 0, col1: 0, row2: 0, col2: 0 }, 'down')!;
    // Hand worked: A1's value moves to A2, so the rule follows it to row 2.
    expect(after(sheet, out.patch).validation).toEqual({
      v1: { type: 'number', ranges: [{ from: ['r2', 'k1'], to: ['r2', 'k1'] }] },
    });
  });

  it('a rule over A1:A3 grows to A1:A4 when a cell is inserted inside it, and shrinks when one is deleted', () => {
    const sheet = rule(['r1', 'k1'], ['r3', 'k1']);
    const grown = insertCells(grid(), sheet, { row1: 1, col1: 0, row2: 1, col2: 0 }, 'down')!;
    expect(after(sheet, grown.patch).validation).toEqual({
      v1: { type: 'number', ranges: [{ from: ['r1', 'k1'], to: ['r4', 'k1'] }] },
    });
    const shrunk = deleteCells(grid(), sheet, { row1: 1, col1: 0, row2: 1, col2: 0 }, 'up')!;
    expect(after(sheet, shrunk.patch).validation).toEqual({
      v1: { type: 'number', ranges: [{ from: ['r1', 'k1'], to: ['r2', 'k1'] }] },
    });
  });

  it('a rule whose cells are all deleted goes', () => {
    const sheet = rule(['r2', 'k1'], ['r2', 'k1']);
    const out = deleteCells(grid(), sheet, { row1: 1, col1: 0, row2: 1, col2: 0 }, 'up')!;
    expect(after(sheet, out.patch).validation).toBeUndefined();
  });

  it('a rule beside the shifted column stays where it is', () => {
    const sheet = rule(['r1', 'k2'], ['r1', 'k2']);
    const out = insertCells(grid(), sheet, { row1: 0, col1: 0, row2: 0, col2: 0 }, 'down')!;
    expect(after(sheet, out.patch).validation).toEqual(sheet.validation);
  });

  it('refuses a shift that would cut a rule range across the edge of the moved cells', () => {
    const sheet = rule(['r1', 'k1'], ['r3', 'k2']);
    expect(insertCells(grid(), sheet, { row1: 1, col1: 0, row2: 1, col2: 0 }, 'down')).toBeNull();
    expect(deleteCells(grid(), sheet, { row1: 1, col1: 0, row2: 1, col2: 0 }, 'up')).toBeNull();
  });

  it('rule and name formulas follow the moved cells', () => {
    const sheet = {
      validation: { v1: { type: 'number', a: '=A3', ranges: [{ from: ['r1', 'k2'], to: ['r1', 'k2'] }] } },
      names: { total: { ref: 'A3' } },
    } as unknown as Sheet;
    const out = insertCells(grid(), sheet, { row1: 0, col1: 0, row2: 0, col2: 0 }, 'down')!;
    // Hand worked: A3 moves to A4.
    const next = after(sheet, out.patch);
    expect((next.validation as { v1: JsonObject }).v1.a).toBe('=A4');
    expect((next.names as { total: { ref: string } }).total.ref).toBe('A4');
  });

  it('other tables that read the cells by name follow them', () => {
    const sales = table([['10'], ['20'], ['30']]);
    const report = table([['=Sales!A2+Sales!A3', '=A1']]);
    const book = { name: 'Sales', others: [{ block: 'b2', data: report }] };
    const change = applyTableOp(sales, { row: 0, column: 0 }, { op: 'insertCells', shift: 'down' }, undefined, book)!;
    const rows = change.also![0].data.rows as TableData['rows'];
    // Hand worked: A2 and A3 of Sales move to A3 and A4; the report's own =A1 stays.
    expect(rows[0].cells.k1.markdown).toBe('=Sales!A3+Sales!A4');
    expect(rows[0].cells.k2.markdown).toBe('=A1');
  });
});

describe('the header row and references', () => {
  const rows = () => table([['10'], ['20'], ['=A1+A2']]);

  it('turning the header on renumbers: the old A1 is gone and A2 becomes A1', () => {
    const change = applyTableOp(rows(), { row: 0, column: 0 }, { op: 'headerRow' })!;
    expect(change.data.header).toBe(true);
    // Hand worked: the first row stops being a body row, so A1 reads #REF! and the old A2 is the new A1.
    expect(change.data.rows[2].cells.k1.markdown).toBe('=#REF!+A1');
  });

  it('turning the header off renumbers: every reference moves down one row', () => {
    const data = { ...rows(), header: true };
    const change = applyTableOp(data, { row: 1, column: 0 }, { op: 'headerRow' })!;
    expect(change.data.header).toBe(false);
    // Hand worked: the header becomes A1, so what was A1 (row 2) is now A2 and A2 is A3.
    expect(change.data.rows[2].cells.k1.markdown).toBe('=A2+A3');
  });
});

describe('availability checks', () => {
  it('canApply runs no reference work and no other table is read', async () => {
    const { canApply, setTableHooks } = await import('../../../../editor/commands/tables');
    const { structureHooks } = await import('./hooks');
    const calls = { follow: 0 };
    setTableHooks({
      ...structureHooks,
      follow: (...args) => {
        calls.follow++;
        return structureHooks.follow(...args);
      },
    });
    try {
      const big = table(Array.from({ length: 50 }, (_, r) => Array.from({ length: 10 }, () => `=A${r + 1}+1`)));
      const book = { name: 'T1', others: [1, 2, 3].map((n) => ({ block: `b${n}`, data: big })) };
      const ops = ['rowAbove', 'rowBelow', 'columnLeft', 'columnRight', 'deleteRow', 'deleteColumn'] as const;
      const start = performance.now();
      let all = true;
      for (let i = 0; i < 20; i++)
        for (const op of ops) all = canApply(big, { row: 5, column: 3 }, { op }, undefined, book) && all;
      expect(all).toBe(true);
      // The toolbar asks on every caret move: under 1 ms for the six tools.
      expect((performance.now() - start) / 20).toBeLessThan(1);
      expect(calls.follow).toBe(0);
      applyTableOp(big, { row: 5, column: 3 }, { op: 'rowAbove' }, undefined, book);
      expect(calls.follow).toBe(1);
    } finally {
      setTableHooks(structureHooks);
    }
  });
});

describe('canApply matches applyTableOp', () => {
  it('says the same for every command, caret, and header setting', async () => {
    const { canApply } = await import('../../../../editor/commands/tables');
    const ops = [
      { op: 'rowAbove' },
      { op: 'rowBelow' },
      { op: 'columnLeft' },
      { op: 'columnRight' },
      { op: 'deleteRow' },
      { op: 'deleteColumn' },
      { op: 'headerRow' },
      { op: 'headerRow', on: true },
      { op: 'headerRow', on: false },
      { op: 'moveRowUp' },
      { op: 'moveRowDown' },
      { op: 'columnWidth', width: 160 },
      { op: 'columnWidth', width: 200 },
    ] as const;
    for (const sizes of [
      [1, 1],
      [1, 3],
      [3, 1],
      [3, 3],
    ]) {
      for (const header of [false, true]) {
        const data = {
          ...table(Array.from({ length: sizes[0] }, () => Array.from({ length: sizes[1] }, () => 'x'))),
          header,
        };
        for (let row = 0; row < sizes[0]; row++)
          for (let column = 0; column < sizes[1]; column++)
            for (const op of ops)
              expect(canApply(data, { row, column }, op), `${JSON.stringify([sizes, header, row, column, op])}`).toBe(
                applyTableOp(data, { row, column }, op) !== null,
              );
      }
    }
  });
});

describe('outline commands at the caret', () => {
  it('collapse and expand act on the group the caret is in or below', () => {
    const data = grid5();
    const grouped = group({}, data, 'rows', 1, 2).sheet;
    const at = (row: number) => ({ row, column: 0 });
    const patch = (c: ReturnType<typeof applyTableOp>) => c!.extra as JsonObject;
    // Hand worked: rows 2 and 3 are grouped, row 4 is the summary. The caret in the group or on the summary finds it.
    for (const row of [1, 2, 3]) {
      const closed = applyTableOp(data, at(row), { op: 'collapse', axis: 'rows' }, grouped);
      expect(after(grouped, patch(closed)).rows).toEqual({
        r2: { level: 1, hidden: true },
        r3: { level: 1, hidden: true },
        r4: { collapsed: true },
      });
    }
    expect(applyTableOp(data, at(0), { op: 'collapse', axis: 'rows' }, grouped)).toBeNull();
    const closed = after(grouped, patch(applyTableOp(data, at(3), { op: 'collapse', axis: 'rows' }, grouped)));
    const open = applyTableOp(data, at(3), { op: 'expand', axis: 'rows' }, closed);
    expect(after(closed, patch(open)).rows).toEqual({ r2: { level: 1 }, r3: { level: 1 } });
  });

  it('a group that ends the table has no summary and does not collapse', () => {
    const data = grid5();
    const grouped = group({}, data, 'rows', 3, 4).sheet;
    expect(applyTableOp(data, { row: 3, column: 0 }, { op: 'collapse', axis: 'rows' }, grouped)).toBeNull();
  });

  it('show level 1 hides every grouped row and level 8 shows all', () => {
    const data = grid5();
    const grouped = group({}, data, 'rows', 1, 2).sheet;
    const at = { row: 0, column: 0 };
    const one = applyTableOp(data, at, { op: 'showLevel', axis: 'rows', level: 1 }, grouped)!;
    const hidden = after(grouped, one.extra as JsonObject);
    expect((hidden.rows as JsonObject).r2).toEqual({ level: 1, hidden: true });
    const all = applyTableOp(data, at, { op: 'showLevel', axis: 'rows', level: 8 }, hidden)!;
    expect(after(hidden, all.extra as JsonObject).rows).toEqual({ r2: { level: 1 }, r3: { level: 1 } });
  });
});
