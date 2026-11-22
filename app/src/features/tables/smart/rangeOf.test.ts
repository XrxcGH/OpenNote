// @vitest-environment jsdom
// The selected range of a cell selection reads the table's map, so a merged cell in the row shifts no column (ADR 0064).
import { EditorState } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { describe, expect, it } from 'vitest';
import { tableDataToDoc } from '../../../editor/table/mapping';
import { tableSchema } from '../../../editor/schema/schema';
import type { TableData } from '../../../editor/schema/specs';
import { rangeOf } from './attach';

const columns = ['c1', 'c2', 'c3'].map((id) => ({ id, width: 100 }));
const data: TableData = {
  header: false,
  columns,
  rows: ['r1', 'r2'].map((id) => ({ id, cells: Object.fromEntries(columns.map((c) => [c.id, { markdown: '' }])) })),
};

describe('rangeOf', () => {
  it('gives grid columns for a selection in a row with a merged cell', () => {
    const doc = tableDataToDoc(data, tableSchema, [{ row: 0, column: 0, rows: 1, columns: 2 }]);
    const table = doc.firstChild!;
    const map = TableMap.get(table);
    const at = (row: number, column: number) => 1 + map.map[row * map.width + column];
    const state = EditorState.create({ doc, selection: CellSelection.create(doc, at(0, 2), at(1, 2)) });
    expect(rangeOf({ state } as never)).toEqual({ row0: 0, row1: 1, col0: 2, col1: 2 });
  });
});
