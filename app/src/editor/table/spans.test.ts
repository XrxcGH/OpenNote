// @vitest-environment jsdom
// The merged cells a table keeps (ADR 0064): the declaration on the table node, the projection of `data.sheet.merges`
// as spans, and the round trip between the block's data and the editor document.
import { describe, expect, it } from 'vitest';
import { createMarkdownCache } from '../markdown';
import { tableSchema } from '../schema/schema';
import type { TableData } from '../schema/specs';
import { docToTableData, tableDataToDoc, tableOf } from './mapping';
import { allowedSpans, spansOf } from './spans';
import { wholeTable } from './tableKit';

function table(rows: number, cols: number, texts: Record<string, string> = {}): TableData {
  const columns = Array.from({ length: cols }, (_, c) => ({ id: `c${c + 1}`, width: 100 + c }));
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

const merge = (from: [string, string], to: [string, string]) => ({ from, to });

describe('spansOf', () => {
  const data = table(4, 4);

  it('turns merges into spans by the current order of rows and columns', () => {
    const sheet = { merges: { m1: merge(['r2', 'c2'], ['r3', 'c3']) } };
    expect(spansOf(data, sheet)).toEqual([{ row: 1, column: 1, rows: 2, columns: 2 }]);
    // The corners in either order give the same box.
    expect(spansOf(data, { merges: { m1: merge(['r3', 'c3'], ['r2', 'c2']) } })).toEqual([
      { row: 1, column: 1, rows: 2, columns: 2 },
    ]);
  });

  it('follows a reordered table, because corners are IDs', () => {
    const moved = { ...data, columns: [data.columns[3], ...data.columns.slice(0, 3)] };
    expect(spansOf(moved, { merges: { m1: merge(['r1', 'c1'], ['r1', 'c2']) } })).toEqual([
      { row: 0, column: 1, rows: 1, columns: 2 },
    ]);
  });

  it('leaves out a merge of one cell, a missing corner, and a merge that overlaps a lower ID', () => {
    const sheet = {
      merges: {
        m1: merge(['r1', 'c1'], ['r1', 'c2']),
        m2: merge(['r1', 'c2'], ['r2', 'c2']),
        m3: merge(['r3', 'c3'], ['r3', 'c3']),
        m4: merge(['r9', 'c1'], ['r9', 'c2']),
      },
    };
    expect(spansOf(data, sheet)).toEqual([{ row: 0, column: 0, rows: 1, columns: 2 }]);
  });

  it('reads nothing from malformed merges', () => {
    expect(spansOf(data, undefined)).toEqual([]);
    expect(spansOf(data, { merges: [1] })).toEqual([]);
    expect(spansOf(data, { merges: { m1: { from: 'r1', to: 7 } } })).toEqual([]);
  });
});

describe('the table document with merges', () => {
  const sheet = { merges: { m1: merge(['r2', 'c2'], ['r3', 'c3']) } };

  it('writes colspan and rowspan on the anchor, omits covered cells, and declares the spans', () => {
    const data = table(4, 4, { B2: 'anchor' });
    const doc = tableDataToDoc(data, tableSchema, spansOf(data, sheet));
    const node = tableOf(doc)!;
    expect(allowedSpans(node)).toEqual([{ row: 1, column: 1, rows: 2, columns: 2 }]);
    const second = node.child(1);
    expect(second.childCount).toBe(3);
    expect(second.child(1).attrs.colspan).toBe(2);
    expect(second.child(1).attrs.rowspan).toBe(2);
    expect(second.child(1).attrs.colwidth).toEqual([101, 102]);
    expect(node.child(2).childCount).toBe(2);
  });

  it('keeps declared spans in the normalizer, and splits a span the table does not declare', () => {
    const data = table(3, 3);
    const merged = { merges: { m1: merge(['r1', 'c1'], ['r1', 'c2']) } };
    const node = tableOf(tableDataToDoc(data, tableSchema, spansOf(data, merged)))!;
    const kept = wholeTable(node, allowedSpans(node));
    expect(kept.child(0).childCount).toBe(2);
    expect(kept.child(0).child(0).attrs.colspan).toBe(2);
    const undeclared = tableSchema.nodes.table.create(null, node.content);
    const split = wholeTable(undeclared, allowedSpans(undeclared));
    expect(split.child(0).childCount).toBe(3);
    expect(split.child(0).child(0).attrs.colspan).toBe(1);
  });

  it('reads the data back: the anchor holds the text, covered cells are empty, and IDs and widths survive', () => {
    const data = table(4, 4, { B2: 'anchor', A1: 'plain' });
    const doc = tableDataToDoc(data, tableSchema, spansOf(data, sheet));
    const back = docToTableData(doc, data, createMarkdownCache());
    expect(back.columns.map((column) => column.id)).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(back.rows.map((row) => row.id)).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(back.rows[1].cells.c2.markdown).toBe('anchor');
    expect(back.rows[1].cells.c3.markdown).toBe('');
    expect(back.rows[2].cells.c2.markdown).toBe('');
    expect(back.rows[0].cells.c1.markdown).toBe('plain');
    expect(back.columns.map((column) => column.width)).toEqual([100, 101, 102, 103]);
  });
});
