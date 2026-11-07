// The structure operations as table operations (DESIGN 13.2). They cover row height, auto-fit, distribute, hiding,
// freeze, outline groups, and cells. `applyStructureOp` takes the table's data and `data.sheet`. It returns the next
// data, the caret, and the merge patch of the keys beside the grid. The editor hands every one of these ops to it
// through hooks.ts, so the page's table commands run them like the row and column commands.

import type { Block, CellAt as At, StructureOp, TableChange } from '../../../../editor/commands/tables';
import type { TableData } from '../../../../editor/schema/specs';
import type { Sheet } from '../model/types';
import { readSheet } from '../model/sheet';
import { deleteCells, insertCells, type CellBox } from './cells';
import type { Edited } from './edit';
import { canvasMeasure, distributedWidths, fitColumnWidths, columnPadding, type FitColumn } from './fit';
import { collapse, expand, group, showLevels, ungroup, clearOutline } from './outline';
import { distributeRows, hideLines, setFreeze, setRowHeight, unhideLines } from './lines';

/** The body text size the default measure uses, in page units. */
const BODY_SIZE = 16;

/** What an operation gives back: the data, the caret, and the merge patch of `data.sheet` (when it changed). */
export type StructureChange = TableChange;

const axisOf = (axis: 'rows' | 'columns') => (axis === 'rows' ? 'rows' : 'cols');

/** Wraps an edit of the sheet as a change; null when it changes nothing. */
function sheetChange(data: TableData, at: At, edited: Edited): StructureChange | null {
  return edited.patch ? { data, caret: at, extra: edited.patch } : null;
}

/** The data after `op`, or null when it changes nothing. `sheet` is the table's `data.sheet`, as stored. */
export function applyStructureOp(data: TableData, at: At, op: StructureOp, stored: unknown): StructureChange | null {
  const sheet: Sheet = readSheet({ sheet: stored });
  const box: Block = ('box' in op && op.box) || { row1: at.row, col1: at.column, row2: at.row, col2: at.column };
  const rows = [box.row1, box.row2] as const;
  const cols = [box.col1, box.col2] as const;
  const done = (edited: Edited) => sheetChange(data, at, edited);
  switch (op.op) {
    case 'rowHeight':
      return done(
        setRowHeight(
          sheet,
          data,
          data.rows.slice(Math.min(...rows), Math.max(...rows) + 1).map((r) => r.id),
          op.height,
          op.exact === true,
        ),
      );
    case 'fitRows':
      return done(
        setRowHeight(
          sheet,
          data,
          data.rows.slice(Math.min(...rows), Math.max(...rows) + 1).map((r) => r.id),
          null,
        ),
      );
    case 'distributeRows':
      return done(distributeRows(sheet, data, rows[0], rows[1], op.heights));
    case 'distributeColumns': {
      const lo = Math.min(...cols);
      const hi = Math.max(...cols);
      const widths = distributedWidths(data.columns.slice(lo, hi + 1).map((c) => c.width));
      return widthChange(data, at, lo, widths);
    }
    case 'fitColumns': {
      const lo = Math.min(...cols);
      const hi = Math.max(...cols);
      const list: FitColumn[] = [];
      const own = (c: number) => data.rows.map((row) => row.cells[data.columns[c].id]?.markdown ?? '');
      for (let c = lo; c <= Math.min(hi, data.columns.length - 1); c++)
        list.push({ index: c, texts: (op.texts ?? own)(c) });
      const fitted = fitColumnWidths(
        list,
        op.measure ?? canvasMeasure(`${BODY_SIZE}px sans-serif`),
        columnPadding(sheet),
      );
      return widthChange(
        data,
        at,
        lo,
        data.columns.slice(lo, hi + 1).map((c, i) => fitted.get(lo + i) ?? c.width),
      );
    }
    case 'hideRows':
      return done(hideLines(sheet, data, 'rows', rows[0], rows[1]));
    case 'unhideRows':
      return done(unhideLines(sheet, data, 'rows', rows[0], rows[1]));
    case 'hideColumns':
      return done(hideLines(sheet, data, 'cols', cols[0], cols[1]));
    case 'unhideColumns':
      return done(unhideLines(sheet, data, 'cols', cols[0], cols[1]));
    case 'freeze':
      return done(setFreeze(sheet, data, op.rows, op.cols));
    case 'freezeAtCaret':
      return done(setFreeze(sheet, data, at.row, at.column));
    case 'freezeTopRow':
      return done(setFreeze(sheet, data, 1, 0));
    case 'freezeFirstColumn':
      return done(setFreeze(sheet, data, 0, 1));
    case 'unfreeze':
      return done(setFreeze(sheet, data, 0, 0));
    case 'groupRows':
      return done(group(sheet, data, 'rows', rows[0], rows[1]));
    case 'ungroupRows':
      return done(ungroup(sheet, data, 'rows', rows[0], rows[1]));
    case 'groupColumns':
      return done(group(sheet, data, 'cols', cols[0], cols[1]));
    case 'ungroupColumns':
      return done(ungroup(sheet, data, 'cols', cols[0], cols[1]));
    case 'clearOutline':
      return done(clearOutline(sheet, data, axisOf(op.axis)));
    case 'collapse':
      return done(collapse(sheet, data, axisOf(op.axis), op.index));
    case 'expand':
      return done(expand(sheet, data, axisOf(op.axis), op.index));
    case 'showLevel':
      return done(showLevels(sheet, data, axisOf(op.axis), op.level));
    case 'insertCells':
    case 'deleteCells': {
      const cell: CellBox = box;
      const changed =
        op.op === 'insertCells' ? insertCells(data, sheet, cell, op.shift) : deleteCells(data, sheet, cell, op.shift);
      return { data: changed.data, caret: at, ...(changed.patch ? { extra: changed.patch } : {}) };
    }
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
