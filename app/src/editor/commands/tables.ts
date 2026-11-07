// The table commands as changes to a table's data (ARCHITECTURE.md section 13; owner: WP6). Each takes the data
// and the cell the caret is in, and returns the next data and the cell for the caret, or null when the command
// doesn't apply. New rows and columns get fresh IDs; a moved row keeps its own, so later merges can match rows.
import type { ResolvedPos } from '@tiptap/pm/model';
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
  /**
   * The merge patch of the keys beside the grid (`data.sheet`) that the change also makes: references, names, merges,
   * and rules that follow inserted, deleted, and moved lines, or the settings a structure command sets.
   */
  extra?: Record<string, unknown>;
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
  | { op: 'columnWidth'; width: number }
  | StructureOp;

/** A block of cells by index into the table's rows and columns, both ends included. Without one, the caret's cell. */
export interface Block {
  row1: number;
  col1: number;
  row2: number;
  col2: number;
}

/**
 * The structure commands (ADR 0056, DESIGN 13.2): row height, fit, distribute, hide, freeze, outline groups, and insert
 * and delete cells. They change `data.sheet` (and the columns' widths), and the spreadsheet registers the code that
 * runs them (`setTableHooks`), so the editor does not import the spreadsheet.
 */
export type StructureOp =
  | { op: 'rowHeight'; height: number | null; exact?: boolean; box?: Block }
  | { op: 'fitRows'; box?: Block }
  | { op: 'distributeRows'; box?: Block; heights?: number[] }
  | { op: 'distributeColumns'; box?: Block }
  /**
   * `texts` is the text each cell of a column shows, by column index (the cells' own text by default); `measure`
   * gives a line's width (a canvas measure of the body font by default).
   */
  | { op: 'fitColumns'; box?: Block; texts?: (column: number) => readonly string[]; measure?: (line: string) => number }
  | { op: 'hideRows' | 'unhideRows' | 'hideColumns' | 'unhideColumns'; box?: Block }
  | { op: 'freeze'; rows: number; cols: number }
  | { op: 'freezeAtCaret' | 'freezeTopRow' | 'freezeFirstColumn' | 'unfreeze' }
  | { op: 'groupRows' | 'ungroupRows' | 'groupColumns' | 'ungroupColumns'; box?: Block }
  | { op: 'clearOutline'; axis: 'rows' | 'columns' }
  | { op: 'collapse' | 'expand'; axis: 'rows' | 'columns'; index: number }
  | { op: 'showLevel'; axis: 'rows' | 'columns'; level: number }
  | { op: 'insertCells'; shift: 'down' | 'right'; box?: Block }
  | { op: 'deleteCells'; shift: 'up' | 'left'; box?: Block };

/**
 * A change of rows or columns, in the formulas' coordinates: zero-based, and A1's row 1 is the first body row.
 * `at` is where lines are inserted or deleted; a move takes `count` lines from `from` and puts them at `to`.
 */
export type LineChange =
  | { kind: 'insertRows' | 'deleteRows' | 'insertCols' | 'deleteCols'; at: number; count: number }
  | { kind: 'moveRows' | 'moveCols'; from: number; count: number; to: number };

/** The code the spreadsheet registers: the structure commands, and the references that follow a line change. */
export interface TableHooks {
  structure(data: TableData, at: CellAt, op: StructureOp, sheet: unknown): TableChange | null;
  /** The change with formulas, names, rules, merges, and ranges brought up to date for `change`. */
  follow(before: TableData, applied: TableChange, change: LineChange, sheet: unknown): TableChange;
}

let hooks: TableHooks | null = null;

/** Registers the spreadsheet's code (null removes it). Tables without it behave as plain grids. */
export function setTableHooks(next: TableHooks | null): void {
  hooks = next;
}

const STRUCTURE_NAMES: ReadonlySet<string> = new Set<StructureOp['op']>([
  'rowHeight',
  'fitRows',
  'distributeRows',
  'distributeColumns',
  'fitColumns',
  'hideRows',
  'unhideRows',
  'hideColumns',
  'unhideColumns',
  'freeze',
  'freezeAtCaret',
  'freezeTopRow',
  'freezeFirstColumn',
  'unfreeze',
  'groupRows',
  'ungroupRows',
  'groupColumns',
  'ungroupColumns',
  'clearOutline',
  'collapse',
  'expand',
  'showLevel',
  'insertCells',
  'deleteCells',
]);

export const isStructureOp = (op: { op: string }): op is StructureOp => STRUCTURE_NAMES.has(op.op);

/** The cell a position is in, or null outside a table. */
function cellOf($pos: ResolvedPos): CellAt | null {
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

/** The cell holding the selection's head, or null outside a table. */
export function cellAt(state: EditorState): CellAt | null {
  const selection = state.selection;
  return cellOf(selection instanceof CellSelection ? selection.$headCell : selection.$head);
}

/** The block of cells a cell selection covers, or null for a caret: the structure commands act on it. */
export function selectionBox(state: EditorState): { row1: number; col1: number; row2: number; col2: number } | null {
  const selection = state.selection;
  if (!(selection instanceof CellSelection)) return null;
  const a = cellOf(selection.$anchorCell);
  const b = cellOf(selection.$headCell);
  if (!a || !b) return null;
  return {
    row1: Math.min(a.row, b.row),
    col1: Math.min(a.column, b.column),
    row2: Math.max(a.row, b.row),
    col2: Math.max(a.column, b.column),
  };
}

/** `op` with the selected block filled in, when it acts on a block and has none. */
export function withSelectionBox(op: TableOp, state: EditorState | null): TableOp {
  if (!state || !isStructureOp(op) || ('box' in op && op.box)) return op;
  const box = selectionBox(state);
  return box && BOX_OPS.has(op.op) ? ({ ...op, box } as TableOp) : op;
}

const BOX_OPS: ReadonlySet<string> = new Set([
  'rowHeight',
  'fitRows',
  'distributeRows',
  'distributeColumns',
  'fitColumns',
  'hideRows',
  'unhideRows',
  'hideColumns',
  'unhideColumns',
  'groupRows',
  'ungroupRows',
  'groupColumns',
  'ungroupColumns',
  'insertCells',
  'deleteCells',
]);

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
export function canApply(data: TableData, at: CellAt, op: TableOp, sheet?: unknown): boolean {
  return applyTableOp(data, at, op, sheet) !== null;
}

/** The data after `op`, or null when it doesn't apply (moving the top row up, deleting the last column). */
/** The narrowest a new column is made to keep a table inside its page. */
const MIN_FITTED_COLUMN = 80;

/**
 * A column just added, narrowed so a table that fitted its page still does: four columns of 160 px in a 623 px page
 * would hide the last column's right-aligned digits behind the scroll (Beta 5 walk W2-13). A table already wider than
 * its page, or with too little room left for a usable column, keeps the width the column got.
 */
export function fitAddedColumn(before: TableData, change: TableChange, room: number): TableChange {
  const total = (data: TableData) => data.columns.reduce((sum, column) => sum + column.width, 0);
  const left = room - total(before);
  if (room <= 0 || total(change.data) <= room || left < 0 || left < MIN_FITTED_COLUMN) return change;
  const index = change.caret?.column ?? -1;
  const columns = change.data.columns.map((column, i) =>
    i === index ? { ...column, width: clampColumnWidth(Math.floor(left)) } : column,
  );
  return { ...change, data: { ...change.data, columns } };
}

/**
 * The data after `op`, or null when it doesn't apply. `sheet` is the table's `data.sheet` as stored: the structure
 * commands read and change it, and inserting, deleting, and moving lines adjust the references, names, merges, and
 * rules in it (ADR 0056). The change carries the patch in `extra`.
 */
export function applyTableOp(input: TableData, at: CellAt, op: TableOp, sheet?: unknown): TableChange | null {
  const data = normalizeTableData(input);
  const cell = clampCell(data, at);
  if (isStructureOp(op)) return hooks?.structure(data, cell, op, sheet) ?? null;
  const applied = applyGridOp(data, cell, op);
  if (!applied) return null;
  const change = referenceChange(data, cell, op);
  return change && hooks ? hooks.follow(data, applied, change, sheet) : applied;
}

/** The change of rows or columns that `op` makes, in the formulas' coordinates (A1 is the first body row), or null. */
function referenceChange(data: TableData, at: CellAt, op: TableOp): LineChange | null {
  const base = data.header ? 1 : 0;
  const { row, column } = at;
  switch (op.op) {
    case 'rowAbove':
      return { kind: 'insertRows', at: Math.max(row, base) - base, count: 1 };
    case 'rowBelow':
      return { kind: 'insertRows', at: row + 1 - base, count: 1 };
    case 'columnLeft':
      return { kind: 'insertCols', at: column, count: 1 };
    case 'columnRight':
      return { kind: 'insertCols', at: column + 1, count: 1 };
    case 'deleteRow':
      return row < base ? null : { kind: 'deleteRows', at: row - base, count: 1 };
    case 'deleteColumn':
      return { kind: 'deleteCols', at: column, count: 1 };
    case 'moveRowUp':
    case 'moveRowDown': {
      const to = op.op === 'moveRowUp' ? row - 1 : row + 1;
      return { kind: 'moveRows', from: row - base, count: 1, to: to - base };
    }
    default:
      return null;
  }
}

function applyGridOp(data: TableData, at: CellAt, op: Exclude<TableOp, StructureOp>): TableChange | null {
  const { row, column } = at;
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
      // Each row's cells follow the columns' order, which is the order page.md writes them in.
      const rows = data.rows.map((one) => ({
        ...one,
        cells: Object.fromEntries(columns.map((c) => [c.id, one.cells[c.id] ?? { markdown: '' }])),
      }));
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
