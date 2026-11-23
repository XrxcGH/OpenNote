// The window arithmetic of row virtualization, worked by hand on rows 30 pixels tall.
import { describe, expect, it } from 'vitest';
import { tableSchema } from '../../../../editor/schema/schema';
import { isVirtualCount, nextWindow, rowAt, staticDocOf, visibleRows } from './rows';

const { nodes } = tableSchema;
const rowsOf = (count: number) =>
  nodes.doc.create(
    null,
    nodes.table.create(
      null,
      Array.from({ length: count }, () =>
        nodes.tableRow.create(null, nodes.tableCell.create(null, nodes.paragraph.create())),
      ),
    ),
  );

/** Rows 30 pixels tall from y = 100. */
const edges = (row: number) => ({ top: 100 + row * 30, bottom: 130 + row * 30 });

describe('visibleRows', () => {
  it('finds the rows that touch the band', () => {
    // The band from 400 to 700 starts in row 10 (400 to 430) and ends in row 19 (670 to 700).
    expect(visibleRows(10_000, edges, 400, 700)).toEqual({ first: 10, last: 19 });
    // A band that starts on a row's bottom edge skips that row.
    expect(visibleRows(10_000, edges, 430, 431)).toEqual({ first: 11, last: 11 });
  });

  it('clamps to the table', () => {
    expect(visibleRows(100, edges, 0, 50)).toEqual({ first: 0, last: 0 });
    expect(visibleRows(100, edges, 100_000, 100_500)).toEqual({ first: 99, last: 99 });
    expect(visibleRows(0, edges, 0, 50)).toBeNull();
  });
});

describe('nextWindow', () => {
  it('keeps a window that still covers the rows near the view', () => {
    const current = { from: 0, to: 60 };
    expect(nextWindow(current, 10, 29, 10_000, 20)).toBe(current);
  });

  it('moves with a margin on each side once the view nears an edge', () => {
    // Visible 45 to 64 with a margin of 20 needs rows up to 75, past 60.
    expect(nextWindow({ from: 0, to: 60 }, 45, 64, 10_000, 20)).toEqual({ from: 25, to: 85 });
    expect(nextWindow({ from: 0, to: 60 }, 9990, 9999, 10_000, 20)).toEqual({ from: 9970, to: 10_000 });
  });
});

describe('the threshold and the static view', () => {
  it('virtualizes above 2,000 rows only', () => {
    expect(isVirtualCount(1999)).toBe(false);
    expect(isVirtualCount(2000)).toBe(false);
    expect(isVirtualCount(2001)).toBe(true);
  });

  it('shows the first 60 rows of a virtual table before the editor mounts, and every row of a smaller one', () => {
    expect(staticDocOf(rowsOf(2001)).firstChild?.childCount).toBe(60);
    const small = rowsOf(2000);
    expect(staticDocOf(small)).toBe(small);
  });

  it('finds the row of a position', () => {
    const doc = rowsOf(3);
    // Row 1 starts after the table's opening (1) and row 0 (6 positions: row, cell, paragraph, and their ends).
    expect(rowAt(doc, 1 + 6 + 3)).toBe(1);
    expect(rowAt(doc, 0)).toBeNull();
  });
});
