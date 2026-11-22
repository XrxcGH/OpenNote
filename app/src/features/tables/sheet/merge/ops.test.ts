// Merge, merge and center, merge across, unmerge, split cell, and the sort refusal (ADR 0064). The expected values are
// worked out by hand from the ADR rules and from the documented behavior of spreadsheets and word processors: a merge
// keeps the top-left value and removes the others after a warning; merge across makes one merge per row; split
// inserts lines.
import { describe, expect, it } from 'vitest';
import { applyTableOp, canApply } from '../../../../editor/commands/tables';
import type { TableChange } from '../../../../editor/commands/tables';
import type { TableData } from '../../../../editor/schema/specs';
import { spansOf } from '../../../../editor/table/spans';
import { applyPatch, type Json, type JsonObject } from '../model/json';
import '../structure/hooks';
import { mergeLoss, sortRefusal } from './index';

/** A table of `rows` by `cols` with IDs r1.. and c1.., and the given texts by address such as "B2". */
function table(rows: number, cols: number, texts: Record<string, string> = {}): TableData {
  const columns = Array.from({ length: cols }, (_, c) => ({ id: `c${c + 1}`, width: 160 }));
  return {
    header: false,
    columns,
    rows: Array.from({ length: rows }, (_, r) => ({
      id: `r${r + 1}`,
      cells: Object.fromEntries(
        columns.map((col, c) => [col.id, { markdown: texts[`${String.fromCharCode(65 + c)}${r + 1}`] ?? '' }]),
      ),
    })),
  };
}

const text = (data: TableData, address: string): string =>
  data.rows[Number(address.slice(1)) - 1].cells[data.columns[address.charCodeAt(0) - 65].id].markdown;

/** The sheet after a change's patch. */
function sheetAfter(stored: Json | undefined, change: TableChange): JsonObject {
  const patch = (change.extra ?? {}) as { sheet?: Json };
  return (applyPatch(stored ?? {}, patch.sheet === undefined ? {} : patch.sheet) ?? {}) as JsonObject;
}

const at = (address: string) => ({ row: Number(address.slice(1)) - 1, column: address.charCodeAt(0) - 65 });
const block = (from: string, to: string) => ({
  row1: at(from).row,
  col1: at(from).column,
  row2: at(to).row,
  col2: at(to).column,
});

type Entry = { from: string[]; to: string[] };

describe('merge cells', () => {
  it('warns that 1 value goes, keeps B2, empties C3, and writes one merge from B2 to C3', () => {
    const data = table(4, 4, { B2: 'keep', C3: 'lost' });
    const change = applyTableOp(data, at('B2'), { op: 'mergeCells', mode: 'merge', box: block('B2', 'C3') })!;
    expect(change.warn).toEqual({ lost: 1 });
    expect(text(change.data, 'B2')).toBe('keep');
    expect(text(change.data, 'C3')).toBe('');
    expect(sheetAfter(undefined, change).merges).toEqual({ m1: { from: ['r2', 'c2'], to: ['r3', 'c3'] } });
    // Undo is the block's one step back to `data`, which still holds C3's text.
    expect(text(data, 'C3')).toBe('lost');
  });

  it('does not warn when every other cell is empty', () => {
    const change = applyTableOp(table(3, 3, { A1: 'x' }), at('A1'), {
      op: 'mergeCells',
      mode: 'merge',
      box: block('A1', 'B2'),
    })!;
    expect(change.warn).toBeUndefined();
  });

  it('counts the values removed by a merge, not the anchor', () => {
    const data = table(2, 2, { A1: 'a', B1: 'b', A2: 'c' });
    expect(mergeLoss(data, [{ top: 0, left: 0, bottom: 1, right: 1 }])).toBe(2);
  });

  it('merges and keeps all text, joined by line breaks, with nothing lost', () => {
    const change = applyTableOp(table(2, 2, { A1: 'one', B1: 'two', A2: 'three' }), at('A1'), {
      op: 'mergeCells',
      mode: 'keep',
      box: block('A1', 'B2'),
    })!;
    expect(change.warn).toBeUndefined();
    expect(text(change.data, 'A1')).toBe('one<br>two<br>three');
    expect(text(change.data, 'B1')).toBe('');
  });

  it('merges and centers, and a second Merge and center on the merge takes it apart', () => {
    const first = applyTableOp(table(2, 3), at('A1'), { op: 'mergeCells', mode: 'center', box: block('A1', 'C1') })!;
    const sheet = sheetAfter(undefined, first);
    expect(sheet.merges).toEqual({ m1: { from: ['r1', 'c1'], to: ['r1', 'c3'] } });
    const styles = sheet.styles as Record<string, { align?: { h?: string } }>;
    expect(Object.values(styles).some((style) => style.align?.h === 'center')).toBe(true);
    const again = { op: 'mergeCells', mode: 'center', box: block('A1', 'C1') } as const;
    const second = applyTableOp(first.data, at('A1'), again, sheet)!;
    expect(sheetAfter(sheet, second).merges).toBeUndefined();
  });

  it('merges across B2:D3 into two merges, B2:D2 and B3:D3', () => {
    const change = applyTableOp(table(4, 4), at('B2'), { op: 'mergeCells', mode: 'across', box: block('B2', 'D3') })!;
    expect(sheetAfter(undefined, change).merges).toEqual({
      m1: { from: ['r2', 'c2'], to: ['r2', 'c4'] },
      m2: { from: ['r3', 'c2'], to: ['r3', 'c4'] },
    });
  });

  it('merges vertically into one merge per column', () => {
    const change = applyTableOp(table(3, 3), at('A1'), { op: 'mergeCells', mode: 'vertical', box: block('A1', 'B3') })!;
    expect(sheetAfter(undefined, change).merges).toEqual({
      m1: { from: ['r1', 'c1'], to: ['r3', 'c1'] },
      m2: { from: ['r1', 'c2'], to: ['r3', 'c2'] },
    });
  });

  it('does nothing for one cell, and refuses a box that cuts through a merge', () => {
    const data = table(3, 3);
    expect(applyTableOp(data, at('B2'), { op: 'mergeCells', mode: 'merge' })).toBeNull();
    const first = applyTableOp(data, at('A1'), { op: 'mergeCells', mode: 'merge', box: block('A1', 'B2') })!;
    const sheet = sheetAfter(undefined, first);
    const cut = { op: 'mergeCells', mode: 'merge', box: block('B2', 'C3') } as const;
    expect(applyTableOp(first.data, at('B2'), cut, sheet)).toBeNull();
  });

  it('absorbs a merge that lies wholly inside the new one', () => {
    const data = table(3, 3);
    const first = applyTableOp(data, at('A1'), { op: 'mergeCells', mode: 'merge', box: block('A1', 'B1') })!;
    const sheet = sheetAfter(undefined, first);
    const wide = { op: 'mergeCells', mode: 'merge', box: block('A1', 'C2') } as const;
    const second = applyTableOp(first.data, at('A1'), wide, sheet)!;
    const merges = sheetAfter(sheet, second).merges as Record<string, unknown>;
    expect(Object.values(merges)).toEqual([{ from: ['r1', 'c1'], to: ['r2', 'c3'] }]);
  });
});

describe('unmerge and split cell', () => {
  const merged = () => {
    const box = { op: 'mergeCells', mode: 'merge', box: block('A1', 'B2') } as const;
    const first = applyTableOp(table(3, 3, { A1: 'a' }), at('A1'), box)!;
    return { data: first.data, sheet: sheetAfter(undefined, first) };
  };

  it('unmerges and keeps the anchor text', () => {
    const { data, sheet } = merged();
    const change = applyTableOp(data, at('A1'), { op: 'unmergeCells', box: block('A1', 'B2') }, sheet)!;
    expect(sheetAfter(sheet, change).merges).toBeUndefined();
    expect(text(change.data, 'A1')).toBe('a');
  });

  it('does nothing to unmerge cells that are not merged', () => {
    expect(applyTableOp(table(2, 2), at('A1'), { op: 'unmergeCells' })).toBeNull();
  });

  it('splits a merged cell by taking the merge apart', () => {
    const { data, sheet } = merged();
    const change = applyTableOp(data, at('A1'), { op: 'splitCell', columns: 2, rows: 1 }, sheet)!;
    expect(sheetAfter(sheet, change).merges).toBeUndefined();
    expect(change.data.columns).toHaveLength(3);
  });

  it('splits plain C2 into 2 columns: one column after C, and every other row merges C with the new column', () => {
    const data = table(3, 4, { C2: 'x', C1: 'top' });
    const change = applyTableOp(data, at('C2'), { op: 'splitCell', columns: 2, rows: 1 })!;
    expect(change.data.columns).toHaveLength(5);
    expect(change.data.rows).toHaveLength(3);
    const newId = change.data.columns[3].id;
    expect(newId).not.toBe('c4');
    expect(change.data.columns[4].id).toBe('c4');
    const sheet = sheetAfter(undefined, change);
    const merges = Object.values(sheet.merges as Record<string, Entry>);
    expect(merges).toHaveLength(2);
    expect(merges).toContainEqual({ from: ['r1', 'c3'], to: ['r1', newId] });
    expect(merges).toContainEqual({ from: ['r3', 'c3'], to: ['r3', newId] });
    // The split cell's row has two separate cells, and the text stays in C2.
    expect(text(change.data, 'C2')).toBe('x');
    expect(text(change.data, 'D2')).toBe('');
    expect(spansOf(change.data, sheet)).toEqual([
      { row: 0, column: 2, rows: 1, columns: 2 },
      { row: 2, column: 2, rows: 1, columns: 2 },
    ]);
  });

  it('splits a plain cell into 2 rows: every other column merges with the new row below', () => {
    const change = applyTableOp(table(2, 3), at('B1'), { op: 'splitCell', columns: 1, rows: 2 })!;
    expect(change.data.rows).toHaveLength(3);
    const newRow = change.data.rows[1].id;
    const merges = Object.values(sheetAfter(undefined, change).merges as Record<string, Entry>);
    expect(merges).toHaveLength(2);
    expect(merges).toContainEqual({ from: ['r1', 'c1'], to: [newRow, 'c1'] });
    expect(merges).toContainEqual({ from: ['r1', 'c3'], to: [newRow, 'c3'] });
  });

  it('extends a merge that ends at the split column over the new column', () => {
    const first = applyTableOp(table(3, 3), at('A1'), { op: 'mergeCells', mode: 'merge', box: block('A1', 'B1') })!;
    const sheet = sheetAfter(undefined, first);
    const change = applyTableOp(first.data, at('B2'), { op: 'splitCell', columns: 2, rows: 1 }, sheet)!;
    const spans = spansOf(change.data, sheetAfter(sheet, change));
    expect(spans).toContainEqual({ row: 0, column: 0, rows: 1, columns: 3 });
    expect(spans).toContainEqual({ row: 2, column: 1, rows: 1, columns: 2 });
  });

  it('refuses a split into one cell, and one that is too large', () => {
    expect(applyTableOp(table(2, 2), at('A1'), { op: 'splitCell', columns: 1, rows: 1 })).toBeNull();
    expect(applyTableOp(table(2, 2), at('A1'), { op: 'splitCell', columns: 9, rows: 9 })).toBeNull();
  });
});

describe('sorting through merges', () => {
  it('is refused when merges of different sizes touch the range, and allowed for equal merges or none', () => {
    const data = table(4, 3);
    const one = applyTableOp(data, at('A1'), { op: 'mergeCells', mode: 'merge', box: block('A1', 'B1') })!;
    const sheet1 = sheetAfter(undefined, one);
    const wide = { op: 'mergeCells', mode: 'merge', box: block('A2', 'C2') } as const;
    const two = applyTableOp(one.data, at('A2'), wide, sheet1)!;
    const sheet2 = sheetAfter(sheet1, two);
    expect(sortRefusal(data, undefined, 0, 3)).toBe(false);
    expect(sortRefusal(data, sheet2, 0, 3)).toBe(true);
    expect(sortRefusal(data, sheet1, 0, 3)).toBe(false);
    expect(sortRefusal(data, sheet2, 2, 3)).toBe(false);
  });

  it('is refused when a merge reaches out of the range', () => {
    const data = table(4, 2);
    const first = applyTableOp(data, at('A1'), { op: 'mergeCells', mode: 'vertical', box: block('A1', 'A2') })!;
    expect(sortRefusal(data, sheetAfter(undefined, first), 1, 3)).toBe(true);
  });
});

describe('moving a row next to or inside a merge', () => {
  // Hand worked: B2:C3 is merged. Swapping row 2 with row 1 would put row 1 inside the span, and swapping row 3 with
  // row 2 would put the anchor under a covered slot, so Excel refuses both. A move that stays clear is allowed.
  const merged = () => {
    const data = table(4, 4, { B1: 'swallowed', C1: 'swallowed2', B2: 'anchor' });
    const change = applyTableOp(data, at('B2'), { op: 'mergeCells', mode: 'merge', box: block('B2', 'C3') })!;
    return { data: change.data, sheet: sheetAfter(undefined, change) };
  };

  it('refuses moveRowUp at B2 and moveRowDown at C3, and keeps the text', () => {
    const { data, sheet } = merged();
    expect(applyTableOp(data, at('B2'), { op: 'moveRowUp' }, sheet)).toBeNull();
    expect(applyTableOp(data, at('C3'), { op: 'moveRowDown' }, sheet)).toBeNull();
    expect(applyTableOp(data, at('C3'), { op: 'moveRowUp' }, sheet)).toBeNull();
    expect(applyTableOp(data, at('A1'), { op: 'moveRowDown' }, sheet)).toBeNull();
    expect(canApply(data, at('B2'), { op: 'moveRowUp' }, sheet)).toBe(false);
    expect(text(data, 'B2')).toBe('anchor');
  });

  it('allows a move that does not touch the merge, and a row with only a one-row merge', () => {
    const top = applyTableOp(table(4, 3), at('A1'), { op: 'mergeCells', mode: 'vertical', box: block('A1', 'A2') })!;
    const topSheet = sheetAfter(undefined, top);
    expect(applyTableOp(top.data, at('A4'), { op: 'moveRowUp' }, topSheet)).not.toBeNull();
    expect(applyTableOp(top.data, at('A3'), { op: 'moveRowUp' }, topSheet)).toBeNull();
    const flat = applyTableOp(table(3, 3), at('A1'), { op: 'mergeCells', mode: 'merge', box: block('A1', 'B1') })!;
    const down = applyTableOp(flat.data, at('A1'), { op: 'moveRowDown' }, sheetAfter(undefined, flat));
    expect(down).not.toBeNull();
    expect(canApply(flat.data, at('A1'), { op: 'moveRowDown' }, sheetAfter(undefined, flat))).toBe(true);
  });
});
