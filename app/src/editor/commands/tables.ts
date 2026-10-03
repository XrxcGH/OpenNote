// The table commands as changes to a table's data (ARCHITECTURE.md section 13; owner: WP6). Each takes the data
// and the cell the caret is in, and returns the next data and the cell for the caret, or null when the command
// doesn't apply. New rows and columns get fresh IDs; a moved row keeps its own, so later merges can match rows.
import type { EditorState } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import { clampColumnWidth, newColumn, newRow, normalizeTableData } from '../table/mapping';
import type { TableData } from '../schema/specs';

/** A cell by row and column index. */
export interface CellAt {
  row: number;
  column: number;
}

export interface TableChange {
  data: TableData;
  /** Where the caret goes, or null when the table is gone. */
  caret: CellAt | null;
}

export type TableOp =
  | { op: 'rowAbove' }
  | { op: 'rowBelow' }
  | { op: 'columnLeft' }
  | { op: 'columnRight' }
  | { op: 'deleteRow' }
  | { op: 'deleteColumn' }
  | { op: 'headerRow'; on?: boolean }
  | { op: 'moveRowUp' }
  | { op: 'moveRowDown' }
  | { op: 'columnWidth'; width: number };

/** The cell holding the selection's head, or null outside a table. */
export function cellAt(state: EditorState): CellAt | null {
  const selection = state.selection;
  const $pos = selection instanceof CellSelection ? selection.$headCell : selection.$head;
  for (let depth = $pos.depth; depth > 0; depth--) {
    const role = $pos.node(depth).type.spec.tableRole as string | undefined;
    if (role === 'row') return { row: $pos.index(depth - 1), column: $pos.index(depth) };
    if (role === 'cell' || role === 'header_cell') {
      return { row: $pos.index(depth - 2), column: $pos.index(depth - 1) };
    }
  }
  if ($pos.depth === 0 && $pos.nodeAfter?.type.spec.tableRole === 'row') return { row: $pos.index(0), column: 0 };
  return null;
}

/** The position inside the paragraph of a cell, at its start or end, in a table document. */
export function cellTextPos(doc: EditorState['doc'], at: CellAt, end = false): number | null {
  const table = doc.firstChild;
  if (!table || at.row >= table.childCount) return null;
  const row = table.child(at.row);
  if (at.column >= row.childCount) return null;
  let pos = 1; // inside the table
  for (let r = 0; r < at.row; r++) pos += table.child(r).nodeSize;
  pos += 1; // inside the row
  for (let c = 0; c < at.column; c++) pos += row.child(c).nodeSize;
  const cell = row.child(at.column);
  const paragraph = cell.firstChild;
  // Inside the cell, then inside its paragraph.
  return pos + 2 + (end && paragraph ? paragraph.content.size : 0);
}

const clampCell = (data: TableData, at: CellAt): CellAt => ({
  row: Math.min(Math.max(0, at.row), data.rows.length - 1),
  column: Math.min(Math.max(0, at.column), data.columns.length - 1),
});

function withRows(data: TableData, rows: TableData['rows']): TableData {
  return { ...data, rows };
}

/** Whether the op can run on this table with the caret in `at`. */
export function canApply(data: TableData, at: CellAt, op: TableOp): boolean {
  return applyTableOp(data, at, op) !== null;
}

/** The data after `op`, or null when it doesn't apply (moving the top row up, deleting the last column). */
export function applyTableOp(input: TableData, at: CellAt, op: TableOp): TableChange | null {
  const data = normalizeTableData(input);
  const { row, column } = clampCell(data, at);
  const firstBody = data.header ? 1 : 0;
  switch (op.op) {
    case 'rowAbove': {
      // Above the header row means a new first body row, so the header stays on top.
      const index = Math.max(row, firstBody);
      const rows = [...data.rows];
      rows.splice(index, 0, newRow(data.columns));
      return { data: withRows(data, rows), caret: { row: index, column } };
    }
    case 'rowBelow': {
      const rows = [...data.rows];
      rows.splice(row + 1, 0, newRow(data.columns));
      return { data: withRows(data, rows), caret: { row: row + 1, column } };
    }
    case 'columnLeft':
    case 'columnRight': {
      const index = op.op === 'columnLeft' ? column : column + 1;
      const added = newColumn(data.columns[column].width);
      const columns = [...data.columns];
      columns.splice(index, 0, added);
      const rows = data.rows.map((one) => ({ ...one, cells: { ...one.cells, [added.id]: { markdown: '' } } }));
      return { data: { ...data, columns, rows }, caret: { row, column: index } };
    }
    case 'deleteRow': {
      if (data.rows.length <= 1) return null;
      const rows = data.rows.filter((_, i) => i !== row);
      // Deleting the header row makes the next row the first; it stays a body row.
      const header = data.header && row !== 0;
      return { data: { ...data, header, rows }, caret: { row: Math.min(row, rows.length - 1), column } };
    }
    case 'deleteColumn': {
      if (data.columns.length <= 1) return null;
      const gone = data.columns[column].id;
      const columns = data.columns.filter((_, i) => i !== column);
      const rows = data.rows.map((one) => {
        const cells = { ...one.cells };
        delete cells[gone];
        return { ...one, cells };
      });
      return { data: { ...data, columns, rows }, caret: { row, column: Math.min(column, columns.length - 1) } };
    }
    case 'headerRow': {
      const header = op.on ?? !data.header;
      if (header === data.header) return null;
      return { data: { ...data, header }, caret: { row, column } };
    }
    case 'moveRowUp':
    case 'moveRowDown': {
      const to = op.op === 'moveRowUp' ? row - 1 : row + 1;
      // The header row stays first, and no body row moves above it.
      if (row < firstBody || to < firstBody || to >= data.rows.length) return null;
      const rows = [...data.rows];
      const [moved] = rows.splice(row, 1);
      rows.splice(to, 0, moved);
      return { data: withRows(data, rows), caret: { row: to, column } };
    }
    case 'columnWidth': {
      const width = clampColumnWidth(op.width);
      if (width === data.columns[column].width) return null;
      const columns = data.columns.map((one, i) => (i === column ? { ...one, width } : one));
      return { data: { ...data, columns }, caret: { row, column } };
    }
  }
}
