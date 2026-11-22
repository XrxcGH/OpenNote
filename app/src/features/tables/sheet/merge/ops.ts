// Merge, merge and center, merge across, merge vertically, unmerge, and split cell (ADR 0064, DESIGN 3.6). A merge is a
// range of corner IDs in `data.sheet.merges` over the whole grid. The anchor (top-left) cell keeps the text. Covered
// cells keep empty Markdown, so a reader without merges shows a sensible table. Every op returns the new data, the
// caret, and one merge patch of `data.sheet`, so the block saves it as one undo step.

import type {
  Block,
  CellAt,
  LineChange,
  StructureOp,
  TableBook,
  TableChange,
} from '../../../../editor/commands/tables';
import { clampColumnWidth, newColumn, newRow } from '../../../../editor/table/mapping';
import type { TableData } from '../../../../editor/schema/specs';
import { applyToRange } from '../model/apply';
import { boxOf, cornersOf, gridOf, isSingle, overlaps, type Box } from '../model/grid';
import { clone, ownObject, put, type JsonObject } from '../model/json';
import { addMerge, mergeSet, removeMerge, type ActiveMerge } from '../model/merges';
import { readSheet, sheetPatch, tidy } from '../model/sheet';
import type { Sheet } from '../model/types';

export type MergeOp = Extract<StructureOp, { op: 'mergeCells' | 'unmergeCells' | 'splitCell' }>;

export const isMergeOp = (op: { op: string }): op is MergeOp =>
  op.op === 'mergeCells' || op.op === 'unmergeCells' || op.op === 'splitCell';

/** What follows a line change: formulas, names, rules, and merges (structure/hooks.ts followReferences). */
export type Follow = (
  before: TableData,
  applied: TableChange,
  change: LineChange,
  stored: unknown,
  book?: TableBook,
) => TableChange;

/** The line break a Markdown table cell uses between lines. */
export const CELL_BREAK = '<br>';

/** The most cells one split makes, so a typo does not make a table of thousands of cells. */
export const SPLIT_LIMIT = 64;

const textOf = (data: TableData, row: number, col: number): string =>
  data.rows[row]?.cells[data.columns[col]?.id ?? '']?.markdown ?? '';

/** How many values a merge of `boxes` removes: the non-empty cells other than each box's anchor. */
export function mergeLoss(data: TableData, boxes: readonly Box[]): number {
  let lost = 0;
  for (const box of boxes)
    for (let r = box.top; r <= box.bottom; r++)
      for (let c = box.left; c <= box.right; c++)
        if ((r !== box.top || c !== box.left) && textOf(data, r, c) !== '') lost++;
  return lost;
}

const clampBox = (data: TableData, box: Block): Box => ({
  top: Math.max(0, Math.min(box.row1, box.row2)),
  bottom: Math.min(data.rows.length - 1, Math.max(box.row1, box.row2)),
  left: Math.max(0, Math.min(box.col1, box.col2)),
  right: Math.min(data.columns.length - 1, Math.max(box.col1, box.col2)),
});

/** Whether `inner` lies wholly inside `outer`. */
const inside = (inner: Box, outer: Box): boolean =>
  inner.top >= outer.top && inner.bottom <= outer.bottom && inner.left >= outer.left && inner.right <= outer.right;

/**
 * The bands to merge for a mode: the whole box, each row of it, or each column of it. A band of one cell is left out.
 */
function bands(mode: 'merge' | 'keep' | 'center' | 'across' | 'vertical', box: Box): Box[] {
  const out: Box[] = [];
  if (mode === 'across') for (let r = box.top; r <= box.bottom; r++) out.push({ ...box, top: r, bottom: r });
  else if (mode === 'vertical') for (let c = box.left; c <= box.right; c++) out.push({ ...box, left: c, right: c });
  else out.push(box);
  return out.filter((band) => !isSingle(band));
}

/** Edits a copy of the stored sheet; the result is the final sheet and the patch from the stored one. */
function finish(
  data: TableData,
  at: CellAt,
  before: Sheet,
  sheet: Sheet,
  extra: Partial<TableChange> = {},
): TableChange | null {
  tidy(sheet, data);
  const patch = sheetPatch(before, sheet);
  return { data, caret: at, ...(patch ? { extra: patch } : {}), ...extra };
}

/** The merges that overlap `box`, or null when one only partly lies inside it (Excel's rule: it would be cut). */
function swallowed(merges: readonly ActiveMerge[], box: Box): ActiveMerge[] | null {
  const hit = merges.filter((m) => overlaps(m.box, box));
  return hit.every((m) => inside(m.box, box)) ? hit : null;
}

function merge(
  data: TableData,
  at: CellAt,
  op: Extract<MergeOp, { op: 'mergeCells' }>,
  stored: unknown,
): TableChange | null {
  const before = readSheet({ sheet: stored });
  const grid = gridOf(data);
  const box = clampBox(data, op.box ?? { row1: at.row, col1: at.column, row2: at.row, col2: at.column });
  let sheet = clone(before);
  // Merge and center on a range that is one merge already takes it apart (Excel's toggle).
  const set = mergeSet(sheet, data);
  if (op.mode === 'center') {
    const same = set.list.find(
      (m) =>
        m.box.top === box.top && m.box.bottom === box.bottom && m.box.left === box.left && m.box.right === box.right,
    );
    if (same) {
      removeMerge(sheet, same.id);
      return finish(data, at, before, sheet);
    }
  }
  const wanted = bands(op.mode, box);
  if (wanted.length === 0) return null;
  const active = mergeSet(sheet, data);
  for (const band of wanted) {
    const hit = swallowed(active.list, band);
    if (!hit) return null;
    for (const one of hit) removeMerge(sheet, one.id);
  }
  const fresh = mergeSet(sheet, data);
  const rows = data.rows.map((row) => ({ ...row, cells: { ...row.cells } }));
  for (const band of wanted) {
    const { from, to } = cornersOf(grid, band);
    const done = addMerge(sheet, data, from, to, fresh);
    if ('refused' in done) return null;
    const joined: string[] = [];
    for (let r = band.top; r <= band.bottom; r++)
      for (let c = band.left; c <= band.right; c++) {
        const text = textOf(data, r, c);
        if (op.mode === 'keep' && text !== '') joined.push(text);
        if (r !== band.top || c !== band.left) {
          const id = data.columns[c].id;
          rows[r].cells[id] = { ...rows[r].cells[id], markdown: '' };
        }
      }
    if (op.mode === 'keep') {
      const id = data.columns[band.left].id;
      rows[band.top].cells[id] = { ...rows[band.top].cells[id], markdown: joined.join(CELL_BREAK) };
    }
  }
  const next: TableData = { ...data, rows };
  if (op.mode === 'center') {
    for (const band of wanted) {
      const { from, to } = cornersOf(grid, band);
      const centered = applyToRange(sheet, next, from, to, { align: { h: 'center' } });
      if (centered.refused) return null;
      sheet = centered.sheet;
    }
  }
  const lost = op.mode === 'keep' ? 0 : mergeLoss(data, wanted);
  return finish(next, { row: box.top, column: box.left }, before, sheet, lost > 0 ? { warn: { lost } } : {});
}

function unmerge(
  data: TableData,
  at: CellAt,
  op: Extract<MergeOp, { op: 'unmergeCells' }>,
  stored: unknown,
): TableChange | null {
  const before = readSheet({ sheet: stored });
  const box = clampBox(data, op.box ?? { row1: at.row, col1: at.column, row2: at.row, col2: at.column });
  const sheet = clone(before);
  const hit = mergeSet(sheet, data).list.filter((m) => overlaps(m.box, box));
  if (hit.length === 0) return null;
  for (const one of hit) removeMerge(sheet, one.id);
  return finish(data, at, before, sheet);
}

/** Moves the corner of a stored merge to the cell at `row` and `col` (positions in `data`). */
function setCorner(sheet: Sheet, id: string, corner: 'from' | 'to', ids: [string, string]): void {
  const merges = ownObject(sheet, 'merges');
  const entry = ownObject(merges, id);
  if (entry) put(entry, corner, ids);
}

/** The lines a split inserts: C divided into `columns` columns, then `rows` rows, with references following. */
function insertLines(
  data: TableData,
  at: CellAt,
  split: { columns: number; rows: number },
  stored: unknown,
  book: TableBook | undefined,
  follow: Follow,
): TableChange {
  const { columns, rows } = split;
  const r = at.row;
  const c = at.column;
  // Columns first: C is divided into `columns` columns of equal width, the new ones right after it.
  let table = data;
  let change: TableChange = { data, caret: at };
  const addedCols = Array.from({ length: columns - 1 }, () => newColumn(Math.max(40, data.columns[c].width / columns)));
  if (addedCols.length > 0) {
    const widths = data.columns.map((col, i) =>
      i === c ? { ...col, width: clampColumnWidth(col.width / columns) } : col,
    );
    const nextColumns = [...widths.slice(0, c + 1), ...addedCols, ...widths.slice(c + 1)];
    const nextRows = data.rows.map((row) => ({
      ...row,
      cells: { ...row.cells, ...Object.fromEntries(addedCols.map((col) => [col.id, { markdown: '' }])) },
    }));
    table = { ...data, columns: nextColumns, rows: nextRows };
    change = follow(
      data,
      { data: table, caret: at },
      { kind: 'insertCols', at: c + 1, count: columns - 1 },
      stored,
      book,
    );
    table = change.data;
  }
  const addedRows = Array.from({ length: rows - 1 }, () => newRow(table.columns));
  if (addedRows.length > 0) {
    const nextRows = [...table.rows.slice(0, r + 1), ...addedRows, ...table.rows.slice(r + 1)];
    const base = data.header ? 1 : 0;
    const before = table;
    const rowChange = follow(
      before,
      { data: { ...table, rows: nextRows }, caret: at },
      { kind: 'insertRows', at: Math.max(r + 1 - base, 0), count: rows - 1 },
      mergedStored(stored, change),
      book,
    );
    change = {
      ...rowChange,
      extra: combine(stored, change, rowChange),
      also: [...(change.also ?? []), ...(rowChange.also ?? [])],
    };
    table = rowChange.data;
  }
  return { ...change, data: table };
}

function split(
  data: TableData,
  at: CellAt,
  op: Extract<MergeOp, { op: 'splitCell' }>,
  stored: unknown,
  book: TableBook | undefined,
  follow: Follow,
): TableChange | null {
  const columns = Math.floor(op.columns);
  const rows = Math.floor(op.rows);
  if (!(columns >= 1 && rows >= 1) || columns * rows < 2 || columns * rows > SPLIT_LIMIT) return null;
  const sheet0 = readSheet({ sheet: stored });
  const there = mergeSet(sheet0, data).list.find(
    (m) => m.box.top <= at.row && m.box.bottom >= at.row && m.box.left <= at.column && m.box.right >= at.column,
  );
  // A merged cell splits back into its cells (Word and Docs).
  if (there)
    return unmerge(
      data,
      at,
      { op: 'unmergeCells', box: { row1: at.row, col1: at.column, row2: at.row, col2: at.column } },
      stored,
    );
  const inserted = insertLines(data, at, { columns, rows }, stored, book, follow);
  return mergeNewLines(data, inserted.data, at, { columns, rows }, stored, inserted);
}

/** The merges a split writes: the new lines join their neighbors, so the rest of the table looks unchanged. */
function mergeNewLines(
  before: TableData,
  table: TableData,
  at: CellAt,
  split: { columns: number; rows: number },
  stored: unknown,
  change: TableChange,
): TableChange | null {
  const { columns, rows } = split;
  const r = at.row;
  const c = at.column;
  const old = mergeSet(readSheet({ sheet: stored }), before);
  const data = before;
  // The merges: edit the sheet the line changes left, in the final grid.
  const after = readSheet({ sheet: mergedStored(stored, change) });
  const sheet = clone(after);
  const grid = gridOf(table);
  const idOfRow = (row: number): string => grid.rows[row];
  const idOfCol = (col: number): string => grid.cols[col];
  const lastCol = c + columns - 1;
  const lastRow = r + rows - 1;
  const newRowIndex = (oldRow: number): number => (oldRow > r ? oldRow + rows - 1 : oldRow);
  const newColIndex = (oldCol: number): number => (oldCol > c ? oldCol + columns - 1 : oldCol);
  const merged = mergeSet(sheet, table);
  // An existing merge that ended at the split column or row reaches over the new lines too.
  for (const m of old.list) {
    const here = merged.list.find((one) => one.id === m.id);
    if (!here) continue;
    if (columns > 1 && m.box.right === c)
      setCorner(sheet, m.id, 'to', [idOfRow(newRowIndex(m.box.bottom)), idOfCol(lastCol)]);
    if (rows > 1 && m.box.bottom === r)
      setCorner(sheet, m.id, 'to', [idOfRow(lastRow), idOfCol(newColIndex(m.box.right))]);
  }
  const fresh = mergeSet(sheet, table);
  const coveredBefore = (row: number, col: number): boolean =>
    old.list.some((m) => row >= m.box.top && row <= m.box.bottom && col >= m.box.left && col <= m.box.right);
  if (columns > 1) {
    for (let row = 0; row < data.rows.length; row++) {
      if (row === r || coveredBefore(row, c)) continue;
      const done = addMerge(
        sheet,
        table,
        [idOfRow(newRowIndex(row)), idOfCol(c)],
        [idOfRow(newRowIndex(row)), idOfCol(lastCol)],
        fresh,
      );
      if ('refused' in done) return null;
    }
  }
  if (rows > 1) {
    for (let col = 0; col < data.columns.length; col++) {
      if (col === c || coveredBefore(r, col)) continue;
      const done = addMerge(
        sheet,
        table,
        [idOfRow(r), idOfCol(newColIndex(col))],
        [idOfRow(lastRow), idOfCol(newColIndex(col))],
        fresh,
      );
      if ('refused' in done) return null;
    }
  }
  tidy(sheet, table);
  const patch = sheetPatch(readSheet({ sheet: stored }), sheet);
  return {
    data: table,
    caret: at,
    ...(patch ? { extra: patch } : {}),
    ...(change.also && change.also.length > 0 ? { also: change.also } : {}),
  };
}

/** The stored `data.sheet` after a change's patch. */
function mergedStored(stored: unknown, change: TableChange): unknown {
  const patch = change.extra as { sheet?: unknown } | undefined;
  if (!patch || !('sheet' in patch)) return stored;
  if (patch.sheet === null) return undefined;
  return applyObjectPatch((stored ?? {}) as JsonObject, patch.sheet as JsonObject);
}

/** RFC 7396 on plain JSON objects: `null` removes a key; objects merge; the rest replaces. */
function applyObjectPatch(target: JsonObject, patch: JsonObject): JsonObject {
  const out: JsonObject = { ...target };
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (value === null) delete out[key];
    else if (typeof value === 'object' && !Array.isArray(value)) {
      const current = out[key];
      out[key] = applyObjectPatch(
        typeof current === 'object' && current !== null && !Array.isArray(current) ? (current as JsonObject) : {},
        value as JsonObject,
      );
    } else out[key] = value;
  }
  return out;
}

/** The patch from `stored` to the sheet after both line changes, as one merge patch. */
function combine(stored: unknown, first: TableChange, second: TableChange): Record<string, unknown> | undefined {
  const sheet = mergedStored(mergedStored(stored, first), second);
  const patch = sheetPatch(readSheet({ sheet: stored }), readSheet({ sheet }));
  return patch ?? undefined;
}

/** The data after a merge op, or null when it changes nothing or cannot run. `follow` is the reference follower. */
export function applyMergeOp(
  data: TableData,
  at: CellAt,
  op: MergeOp,
  stored: unknown,
  book: TableBook | undefined,
  follow: Follow,
): TableChange | null {
  switch (op.op) {
    case 'mergeCells':
      return merge(data, at, op, stored);
    case 'unmergeCells':
      return unmerge(data, at, op, stored);
    case 'splitCell':
      return split(data, at, op, stored, book, follow);
  }
}

export { boxOf };
