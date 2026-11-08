// The structure operations as table operations (DESIGN 13.2). They cover row height, auto-fit, distribute, hiding,
// freeze, outline groups, and cells. `applyStructureOp` takes the table's data and `data.sheet`. It returns the next
// data, the caret, and the merge patch of the keys beside the grid. The editor hands every one of these ops to it
// through hooks.ts, so the page's table commands run them like the row and column commands.

import type { Block, CellAt as At, StructureOp, TableBook, TableChange } from '../../../../editor/commands/tables';
import type { TableData } from '../../../../editor/schema/specs';
import type { Sheet } from '../model/types';
import { readSheet } from '../model/sheet';
import { deleteCells, insertCells, type CellBox } from './cells';
import type { Edited } from './edit';
import { canvasMeasure, distributedWidths, fitColumnWidths, columnPadding, type FitColumn } from './fit';
import { collapse, expand, group, showLevels, summaryAt, ungroup, clearOutline } from './outline';
import { distributeRows, hideLines, setFreeze, setRowHeight, unhideLines } from './lines';

/** The body text size the default measure uses, in page units. */
const BODY_SIZE = 16;

/** The page's body font, as the cells are drawn in it; a sans-serif of the body size when there is no document. */
function bodyFont(): string {
  try {
    if (typeof document !== 'undefined' && document.body) {
      const style = getComputedStyle(document.body);
      if (style.font) return style.font;
    }
  } catch {
    // Without a style, the default below holds.
  }
  return `${BODY_SIZE}px sans-serif`;
}

/**
 * The text a cell shows when only its markdown is known: a formula has no value here, so it counts as empty, and the
 * marks of bold, italic, strike, and code do not take room.
 */
export function shownText(markdown: string): string {
  if (markdown.startsWith('=') && markdown.length > 1) return '';
  return markdown.replace(/\*\*|__|~~|[*`]/g, '');
}

/** What an operation gives back: the data, the caret, and the merge patch of `data.sheet` (when it changed). */
export type StructureChange = TableChange;

const axisOf = (axis: 'rows' | 'columns') => (axis === 'rows' ? 'rows' : 'cols');

/** Wraps an edit of the sheet as a change; null when it changes nothing. */
function sheetChange(data: TableData, at: At, edited: Edited): StructureChange | null {
  return edited.patch ? { data, caret: at, extra: edited.patch } : null;
}

/** What each structure op reads: the table, the caret, the sheet, and the block the op acts on. */
interface Ctx {
  data: TableData;
  at: At;
  sheet: Sheet;
  rows: readonly [number, number];
  cols: readonly [number, number];
  box: Block;
  done(edited: Edited): StructureChange | null;
}

type Pick<K extends StructureOp['op']> = Extract<StructureOp, { op: K }>;
type SizeOp = Pick<'rowHeight' | 'fitRows' | 'distributeRows' | 'distributeColumns' | 'fitColumns'>;
type HideOp = Pick<
  | 'hideRows'
  | 'unhideRows'
  | 'hideColumns'
  | 'unhideColumns'
  | 'freeze'
  | 'freezeAtCaret'
  | 'freezeTopRow'
  | 'freezeFirstColumn'
  | 'unfreeze'
>;
type OutlineOp = Pick<
  'groupRows' | 'ungroupRows' | 'groupColumns' | 'ungroupColumns' | 'clearOutline' | 'collapse' | 'expand' | 'showLevel'
>;
type CellsOp = Pick<'insertCells' | 'deleteCells'>;

/** Row heights, auto-fit, and distribute. */
function sizeOp(op: SizeOp, c: Ctx): StructureChange | null {
  const { data, at, sheet, rows, cols } = c;
  const lo = Math.min(...cols);
  const hi = Math.max(...cols);
  const ids = () => data.rows.slice(Math.min(...rows), Math.max(...rows) + 1).map((r) => r.id);
  switch (op.op) {
    case 'rowHeight':
      return c.done(setRowHeight(sheet, data, ids(), op.height, op.exact === true));
    case 'fitRows':
      return c.done(setRowHeight(sheet, data, ids(), null));
    case 'distributeRows':
      return c.done(distributeRows(sheet, data, rows[0], rows[1], op.heights));
    case 'distributeColumns':
      return widthChange(data, at, lo, distributedWidths(data.columns.slice(lo, hi + 1).map((col) => col.width)));
    case 'fitColumns': {
      const list: FitColumn[] = [];
      const own = (col: number) => data.rows.map((row) => shownText(row.cells[data.columns[col].id]?.markdown ?? ''));
      for (let col = lo; col <= Math.min(hi, data.columns.length - 1); col++)
        list.push({ index: col, texts: (op.texts ?? own)(col) });
      const fitted = fitColumnWidths(list, op.measure ?? canvasMeasure(bodyFont()), columnPadding(sheet));
      return widthChange(
        data,
        at,
        lo,
        data.columns.slice(lo, hi + 1).map((col, i) => fitted.get(lo + i) ?? col.width),
      );
    }
  }
}

/** Hiding lines and freeze panes. */
function hideOp(op: HideOp, c: Ctx): StructureChange | null {
  const { data, at, sheet, rows, cols } = c;
  switch (op.op) {
    case 'hideRows':
      return c.done(hideLines(sheet, data, 'rows', rows[0], rows[1]));
    case 'unhideRows':
      return c.done(unhideLines(sheet, data, 'rows', rows[0], rows[1]));
    case 'hideColumns':
      return c.done(hideLines(sheet, data, 'cols', cols[0], cols[1]));
    case 'unhideColumns':
      return c.done(unhideLines(sheet, data, 'cols', cols[0], cols[1]));
    case 'freeze':
      return c.done(setFreeze(sheet, data, op.rows, op.cols));
    case 'freezeAtCaret':
      return c.done(setFreeze(sheet, data, at.row, at.column));
    case 'freezeTopRow':
      return c.done(setFreeze(sheet, data, 1, 0));
    case 'freezeFirstColumn':
      return c.done(setFreeze(sheet, data, 0, 1));
    case 'unfreeze':
      return c.done(setFreeze(sheet, data, 0, 0));
  }
}

/** Outline groups. */
function outlineOp(op: OutlineOp, c: Ctx): StructureChange | null {
  const { data, at, sheet, rows, cols } = c;
  switch (op.op) {
    case 'groupRows':
      return c.done(group(sheet, data, 'rows', rows[0], rows[1]));
    case 'ungroupRows':
      return c.done(ungroup(sheet, data, 'rows', rows[0], rows[1]));
    case 'groupColumns':
      return c.done(group(sheet, data, 'cols', cols[0], cols[1]));
    case 'ungroupColumns':
      return c.done(ungroup(sheet, data, 'cols', cols[0], cols[1]));
    case 'clearOutline':
      return c.done(clearOutline(sheet, data, axisOf(op.axis)));
    case 'showLevel':
      return c.done(showLevels(sheet, data, axisOf(op.axis), op.level));
    case 'collapse':
    case 'expand': {
      const axis = axisOf(op.axis);
      const index = op.index ?? summaryAt(sheet, data, axis, axis === 'rows' ? at.row : at.column);
      if (index === null) return null;
      return c.done((op.op === 'collapse' ? collapse : expand)(sheet, data, axis, index));
    }
  }
}

/** Insert and delete cells with a shift. */
function cellsOp(op: CellsOp, c: Ctx, book?: TableBook): StructureChange | null {
  const cell: CellBox = c.box;
  const { data, sheet } = c;
  const changed =
    op.op === 'insertCells'
      ? insertCells(data, sheet, cell, op.shift, book)
      : deleteCells(data, sheet, cell, op.shift, book);
  if (!changed) return null;
  return {
    data: changed.data,
    caret: c.at,
    ...(changed.patch ? { extra: changed.patch } : {}),
    ...(changed.also ? { also: changed.also } : {}),
  };
}

/** The data after `op`, or null when it changes nothing. `sheet` is the table's `data.sheet`, as stored. */
export function applyStructureOp(
  data: TableData,
  at: At,
  op: StructureOp,
  stored: unknown,
  book?: TableBook,
): StructureChange | null {
  const box: Block = ('box' in op && op.box) || { row1: at.row, col1: at.column, row2: at.row, col2: at.column };
  const c: Ctx = {
    data,
    at,
    sheet: readSheet({ sheet: stored }),
    box,
    rows: [box.row1, box.row2],
    cols: [box.col1, box.col2],
    done: (edited) => sheetChange(data, at, edited),
  };
  switch (op.op) {
    case 'rowHeight':
    case 'fitRows':
    case 'distributeRows':
    case 'distributeColumns':
    case 'fitColumns':
      return sizeOp(op, c);
    case 'insertCells':
    case 'deleteCells':
      return cellsOp(op, c, book);
    case 'groupRows':
    case 'ungroupRows':
    case 'groupColumns':
    case 'ungroupColumns':
    case 'clearOutline':
    case 'collapse':
    case 'expand':
    case 'showLevel':
      return outlineOp(op, c);
    default:
      return hideOp(op, c);
  }
}

/** New widths for the columns from index `from`; null when none changed. */
function widthChange(data: TableData, at: At, from: number, widths: readonly number[]): StructureChange | null {
  let changed = false;
  const columns = data.columns.map((column, i) => {
    const width = widths[i - from];
    if (i < from || width === undefined || width === column.width) return column;
    changed = true;
    return { ...column, width };
  });
  return changed ? { data: { ...data, columns }, caret: at } : null;
}
