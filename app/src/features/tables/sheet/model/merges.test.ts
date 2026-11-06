import { describe, expect, it } from 'vitest';
import { gridOf, type Box } from './grid';
import { activeMerges, addMerge, MERGE_LIMIT, mergeAt, mergeSet, removeMerge, repairMerges } from './merges';
import { tidy } from './sheet';
import { K, R, makeTable, range, specCase } from './testing';
import type { Sheet, TableLike } from './types';

/** A box in A1 terms, such as B2:C4. */
function a1(box: Box | undefined): string {
  if (!box) return 'none';
  const cell = (r: number, c: number) => `${'ABCDEFGHIJ'[c]}${r + 1}`;
  return `${cell(box.top, box.left)}:${cell(box.bottom, box.right)}`;
}

/** The table with some rows or columns left out, as a delete leaves it. */
function without(table: TableLike, rows: string[], cols: string[]): TableLike {
  return {
    ...table,
    columns: table.columns.filter((c) => !cols.includes(c.id)),
    rows: table.rows.filter((r) => !rows.includes(r.id)),
  };
}

describe('merges (R-SHT-12)', () => {
  it('uses the merges the spec fixture lists, in ID order, with overlaps repaired by the lower ID', () => {
    const c = specCase('merges.json');
    const ids = activeMerges(c.data.sheet as Sheet, c.data).map((m) => m.id);
    expect(ids).toEqual(c.expect?.activeMerges);
  });

  it('grows on insert, moves its corner on delete, and goes when one cell is left', () => {
    const start = makeTable([1, 2, 3, 4], [1, 2, 3, 4]);
    const sheet: Sheet = {};
    const added = addMerge(sheet, start, [R(2), K(2)], [R(3), K(3)]);
    expect(added).toEqual({ id: 'm1' });
    expect(a1(activeMerges(sheet, start)[0]?.box)).toBe('B2:C3');

    // Insert a row between rows 2 and 3: the merge covers B2:C4 without a change to the file.
    const inserted = makeTable([1, 2, 99, 3, 4], [1, 2, 3, 4]);
    const file = JSON.stringify(sheet);
    tidy(sheet, inserted, start);
    expect(JSON.stringify(sheet)).toBe(file);
    expect(a1(activeMerges(sheet, inserted)[0]?.box)).toBe('B2:C4');

    // Delete column B: the corner moves to the nearest column left inside the merge.
    const noB = without(inserted, [], [K(2)]);
    tidy(sheet, noB, inserted);
    const merge = (sheet.merges as Record<string, { from: string[]; to: string[] }>).m1;
    expect(merge.from).toEqual([R(2), K(3)]);
    const box = activeMerges(sheet, noB)[0]?.box;
    // In the new table, column C is the second column, so its position reads B; name the cells by ID instead.
    expect(box && [gridOf(noB).rows[box.top], gridOf(noB).cols[box.left]]).toEqual([R(2), K(3)]);
    expect(box && [gridOf(noB).rows[box.bottom], gridOf(noB).cols[box.right]]).toEqual([R(3), K(3)]);

    // Delete the inserted row and row 3: one cell, C2, is left, so the merge goes.
    tidy(sheet, without(noB, [R(99), R(3)], []), noB);
    expect(sheet.merges).toBeUndefined();
  });

  it('goes when a row and a column are deleted so that one cell remains', () => {
    const table = makeTable([1, 2, 3], [1, 2, 3]);
    const sheet: Sheet = {};
    addMerge(sheet, table, [R(2), K(2)], [R(3), K(3)]);
    tidy(sheet, without(table, [R(2)], [K(3)]), table);
    expect(sheet.merges).toBeUndefined();
  });

  it('goes when every row or column it covered is deleted', () => {
    const table = makeTable([1, 2, 3], [1, 2, 3]);
    const sheet: Sheet = {};
    addMerge(sheet, table, [R(1), K(2)], [R(3), K(3)]);
    repairMerges(sheet, table, without(table, [], [K(2), K(3)]));
    expect(sheet.merges).toBeUndefined();
  });

  it('refuses one cell, overlaps, and missing corners, and removes merges', () => {
    const table = makeTable(range(1, 3), range(1, 3));
    const sheet: Sheet = {};
    expect(addMerge(sheet, table, [R(1), K(1)], [R(1), K(1)])).toEqual({ refused: 'single' });
    expect(addMerge(sheet, table, [R(1), K(1)], [R(2), K(2)])).toEqual({ id: 'm1' });
    expect(addMerge(sheet, table, [R(2), K(2)], [R(3), K(3)])).toEqual({ refused: 'overlap' });
    expect(addMerge(sheet, table, [R(9), K(1)], [R(3), K(3)])).toEqual({ refused: 'missing' });
    expect(addMerge(sheet, table, [R(3), K(3)], [R(3), K(2)])).toEqual({ id: 'm2' });
    removeMerge(sheet, 'm1');
    removeMerge(sheet, 'm2');
    expect(sheet.merges).toBeUndefined();
  });

  it('drops the merge with the higher ID when two devices merged overlapping cells', () => {
    const table = makeTable(range(1, 3), range(1, 3));
    const sheet: Sheet = {
      merges: {
        m2: { from: [R(2), K(2)], to: [R(3), K(3)] },
        m1: { from: [R(1), K(1)], to: [R(2), K(2)] },
        m3: { from: [R(3), K(1)], to: [R(3), K(1)] },
        x9: { cells: 'a later shape' },
      },
    };
    expect(activeMerges(sheet, table).map((m) => m.id)).toEqual(['m1']);
    tidy(sheet, table);
    expect(Object.keys(sheet.merges as object).sort()).toEqual(['m1', 'x9']);
  });
});

describe('merges at scale', () => {
  it('adds and tidies 10,000 merges, the limit, in well under a second', () => {
    // 200 rows by 100 columns, merged into 10,000 boxes of two rows by one column.
    const table = makeTable(range(1, 200), range(1, 100));
    const sheet: Sheet = {};
    const start = performance.now();
    const set = mergeSet(sheet, table);
    let added = 0;
    for (let r = 1; r <= 200; r += 2)
      for (let c = 1; c <= 100; c++) if ('id' in addMerge(sheet, table, [R(r), K(c)], [R(r + 1), K(c)], set)) added++;
    expect(added).toBe(MERGE_LIMIT);
    expect(addMerge(sheet, table, [R(1), K(1)], [R(1), K(1)], set)).toEqual({ refused: 'single' });
    expect(addMerge(sheet, table, [R(1), K(1)], [R(1), K(2)], set)).toEqual({ refused: 'overlap' });
    tidy(sheet, table);
    expect(activeMerges(sheet, table)).toHaveLength(MERGE_LIMIT);
    // About 12 s before the merges were indexed by row; the bound leaves room for a loaded machine.
    expect(performance.now() - start).toBeLessThan(1000);
    expect(Object.keys(sheet.merges as object)).toHaveLength(MERGE_LIMIT);
  });

  it('finds the same overlaps and covering merges as a check of every pair', () => {
    const table = makeTable(range(1, 12), range(1, 12));
    const sheet: Sheet = {};
    let seed = 7;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return 1 + (seed % n);
    };
    for (let n = 0; n < 300; n++) {
      const box = [next(12), next(12), next(12), next(12)];
      const plain = activeMerges(sheet, table);
      const r1 = Math.min(box[0], box[1]) - 1;
      const r2 = Math.max(box[0], box[1]) - 1;
      const c1 = Math.min(box[2], box[3]) - 1;
      const c2 = Math.max(box[2], box[3]) - 1;
      const clash = plain.some((m) => !(m.box.bottom < r1 || r2 < m.box.top || m.box.right < c1 || c2 < m.box.left));
      const got = addMerge(sheet, table, [R(box[0]), K(box[2])], [R(box[1]), K(box[3])]);
      if (r1 === r2 && c1 === c2) expect(got).toEqual({ refused: 'single' });
      else expect('refused' in got, `box ${box.join(',')}`).toBe(clash);
    }
    const set = mergeSet(sheet, table);
    for (let r = 0; r < 12; r++)
      for (let c = 0; c < 12; c++) expect(set.index.at(r, c)).toBe(mergeAt(set.list, r, c)?.id);
  });
});
