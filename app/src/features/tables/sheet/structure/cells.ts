// Insert cells and delete cells with a shift direction (DESIGN 13.2). The cells' text moves, and so do their styles
// and notes; row and column IDs stay where they are, so row and column settings stay too. References to the moved
// cells follow them (a formula in another cell keeps pointing at the same text). A reference to a deleted cell becomes
// #REF!. A reference to a range that is only partly inside the block stays as it is.

import type { TableData } from '../../../../editor/schema/specs';
import { newColumn, newRow } from '../../../../editor/table/mapping';
import { clone, isObject, ownObject, type Json, type JsonObject } from '../model/json';
import { activeMerges } from '../model/merges';
import { sheetPatch, tidy } from '../model/sheet';
import type { Sheet } from '../model/types';
import { dropEmpty } from './edit';
import type { TableBook, TableChange } from '../../../../editor/commands/tables';
import { followInOthers } from './others';
import { mapSpan, moveEntries, rewriteSheetText, shiftFormula, type Shift } from './reflow';

/** A block of cells by index into `data.rows` and `data.columns`, both ends included. */
export interface CellBox {
  row1: number;
  col1: number;
  row2: number;
  col2: number;
}

export type InsertShift = 'down' | 'right';
export type DeleteShift = 'up' | 'left';

export interface CellsChange {
  data: TableData;
  patch: JsonObject | null;
  /** The patches of the page's other tables whose references into this one follow the moved cells. */
  also?: NonNullable<TableChange['also']>;
}

const BLANK = { markdown: '' };

/** A shift in the formulas' coordinates: A1's row 1 is the first body row, so a header row moves the rows up by one. */
function formulaShift(data: TableData, s: Shift): Shift {
  const base = data.header ? 1 : 0;
  const row = (n: number) => (Number.isFinite(n) ? n - base : n);
  return {
    ...s,
    row1: row(s.row1),
    row2: row(s.row2),
    ...(s.gone ? { gone: { ...s.gone, row1: row(s.gone.row1), row2: row(s.gone.row2) } } : {}),
  };
}

/** The last row and column index that hold anything (text, a style, or a note) inside the given columns or rows. */
function lastUsed(data: TableData, sheet: Sheet, box: CellBox, down: boolean): number {
  let last = -1;
  const styles = (sheet.cells ?? {}) as JsonObject;
  data.rows.forEach((row, r) => {
    data.columns.forEach((column, c) => {
      const inBand = down ? c >= box.col1 && c <= box.col2 : r >= box.row1 && r <= box.row2;
      if (!inBand) return;
      const hasStyle = (styles[row.id] as JsonObject | undefined)?.[column.id] !== undefined;
      if ((row.cells[column.id]?.markdown ?? '') !== '' || hasStyle) last = Math.max(last, down ? r : c);
    });
  });
  return last;
}

/** Orders a box so that its first corner is the top left one, and keeps it inside the table. */
export function clampBox(data: TableData, box: CellBox): CellBox {
  const at = (n: number, max: number) => Math.min(max, Math.max(0, n));
  const rows = data.rows.length - 1;
  const cols = data.columns.length - 1;
  return {
    row1: at(Math.min(box.row1, box.row2), rows),
    row2: at(Math.max(box.row1, box.row2), rows),
    col1: at(Math.min(box.col1, box.col2), cols),
    col2: at(Math.max(box.col1, box.col2), cols),
  };
}

/** A merge by the index of its corners, and whether the shift moves it with its cells or removes it. */
interface MergeMove {
  id: string;
  from: [number, number];
  to: [number, number];
  drop: boolean;
}

type Region = CellBox | null;
const touches = (b: { top: number; left: number; bottom: number; right: number }, r: CellBox): boolean =>
  b.top <= r.row2 && b.bottom >= r.row1 && b.left <= r.col2 && b.right >= r.col1;
const within = (b: { top: number; left: number; bottom: number; right: number }, r: CellBox): boolean =>
  b.top >= r.row1 && b.bottom <= r.row2 && b.left >= r.col1 && b.right <= r.col2;

/**
 * What the shift does to each merge. A merge wholly inside the moving cells moves with them, and one wholly inside
 * the deleted cells goes. A merge that crosses an edge of either would be cut, so the result is null: Excel refuses
 * such a change as well.
 */
function planMerges(data: TableData, sheet: Sheet, moving: CellBox, removedBox: Region): MergeMove[] | null {
  const out: MergeMove[] = [];
  for (const { id, box } of activeMerges(sheet, data)) {
    if (removedBox && touches(box, removedBox)) {
      if (!within(box, removedBox)) return null;
      out.push({ id, from: [box.top, box.left], to: [box.bottom, box.right], drop: true });
    } else if (touches(box, moving)) {
      if (!within(box, moving)) return null;
      out.push({ id, from: [box.top, box.left], to: [box.bottom, box.right], drop: false });
    }
  }
  return out;
}

/** Writes the moved merges' corners and removes the dropped ones. */
function moveMerges(
  sheet: Sheet,
  merges: readonly MergeMove[],
  move: (r: number, c: number) => [number, number] | null,
  rowIds: readonly string[],
  colIds: readonly string[],
): void {
  const stored = ownObject(sheet, 'merges');
  if (!stored) return;
  for (const m of merges) {
    const a = m.drop ? null : move(m.from[0], m.from[1]);
    const b = m.drop ? null : move(m.to[0], m.to[1]);
    if (
      !a ||
      !b ||
      rowIds[a[0]] === undefined ||
      colIds[a[1]] === undefined ||
      rowIds[b[0]] === undefined ||
      colIds[b[1]] === undefined
    ) {
      delete stored[m.id];
    } else {
      stored[m.id] = { from: [rowIds[a[0]], colIds[a[1]]], to: [rowIds[b[0]], colIds[b[1]]] };
    }
  }
}

/**
 * Moves the corner ranges of validation and conditional-format rules with the cells they cover, the way formula ranges
 * follow: a range inside the band of the shift grows, shrinks, or goes; a range outside it stays. A range that only
 * partly crosses the band and reaches the moved cells would be cut, so the result is false and the shift is refused,
 * as for merges. Whole-column and whole-row ranges are kept as they are.
 */
function moveRuleRanges(sheet: Sheet, s: Shift, rowIds: readonly string[], colIds: readonly string[]): boolean {
  const vertical = s.dCol === 0;
  const count = vertical ? s.dRow : s.dCol;
  const start = vertical ? s.row1 : s.col1;
  const from = count > 0 ? start : start + count;
  const rowAt = new Map(rowIds.map((id, i) => [id, i]));
  const colAt = new Map(colIds.map((id, i) => [id, i]));
  for (const kind of ['validation', 'conditional']) {
    const rules = ownObject(sheet, kind);
    if (!rules) continue;
    for (const id of Object.keys(rules)) {
      const rule = ownObject(rules, id);
      if (!rule || !Array.isArray(rule.ranges)) continue;
      const kept: Json[] = [];
      for (const range of rule.ranges) {
        const f = isObject(range) && Array.isArray(range.from) ? range.from : null;
        const t = isObject(range) && Array.isArray(range.to) ? range.to : null;
        const a = f && [rowAt.get(f[0] as string), colAt.get(f[1] as string)];
        const b = t && [rowAt.get(t[0] as string), colAt.get(t[1] as string)];
        if (!a || !b || a.includes(undefined) || b.includes(undefined)) {
          kept.push(range as Json);
          continue;
        }
        const [r1, r2] = [Math.min(a[0]!, b[0]!), Math.max(a[0]!, b[0]!)];
        const [c1, c2] = [Math.min(a[1]!, b[1]!), Math.max(a[1]!, b[1]!)];
        const lo = vertical ? c1 : r1;
        const hi = vertical ? c2 : r2;
        const first = vertical ? r1 : c1;
        const last = vertical ? r2 : c2;
        const bandLo = vertical ? s.col1 : s.row1;
        const bandHi = vertical ? s.col2 : s.row2;
        if (lo < bandLo || hi > bandHi) {
          // Outside the band, or across its edge: across the edge and reaching the moved cells would cut it.
          const crosses = lo <= bandHi && hi >= bandLo && last >= from;
          if (crosses) return false;
          kept.push(range as Json);
          continue;
        }
        const span = mapSpan(first, last, from, count);
        if (span === null) continue;
        const rows = vertical ? span : [r1, r2];
        const cols = vertical ? [c1, c2] : span;
        const id = (ids: readonly string[], n: number) => ids[Math.min(n, ids.length - 1)];
        kept.push({
          ...(range as JsonObject),
          from: [id(rowIds, rows[0]), id(colIds, cols[0])],
          to: [id(rowIds, rows[1]), id(colIds, cols[1])],
        });
      }
      if (kept.length === 0) delete rules[id];
      else rule.ranges = kept;
    }
  }
  return true;
}

function build(
  data: TableData,
  sheet: Sheet,
  move: (r: number, c: number) => [number, number] | null,
  shift: Shift,
  rowsNeeded: number,
  colsNeeded: number,
  merges: readonly MergeMove[],
  book?: TableBook,
): CellsChange | null {
  const columns = [...data.columns];
  while (columns.length < colsNeeded) columns.push(newColumn(columns[columns.length - 1]?.width));
  const rows = data.rows.map((row) => ({
    ...row,
    cells: Object.fromEntries(columns.map((c) => [c.id, row.cells[c.id] ?? { ...BLANK }])),
  }));
  while (rows.length < rowsNeeded) rows.push(newRow(columns));
  const next = rows.map((row) => ({ ...row, cells: { ...row.cells } }));
  // First blank every cell that leaves its place or is removed, then write the movers at their new places.
  const sources: { r: number; c: number; to: [number, number] | null }[] = [];
  data.rows.forEach((_, r) =>
    data.columns.forEach((_c, c) => {
      const to = move(r, c);
      if (to === null || to[0] !== r || to[1] !== c) sources.push({ r, c, to });
    }),
  );
  for (const { r, c } of sources) next[r].cells[columns[c].id] = { ...BLANK };
  for (const { r, c, to } of sources) {
    // A blank cell that moves past the table's end has nothing to keep: the table does not grow for it.
    if (!to || to[0] >= next.length || to[1] >= columns.length) continue;
    const text = rows[r].cells[columns[c].id];
    next[to[0]].cells[columns[to[1]].id] = text;
  }
  const fshift = formulaShift(data, shift);
  const rewrite = (formula: string) => shiftFormula(formula, fshift, { own: book?.name });
  const out = next.map((row) => {
    let cells = row.cells;
    for (const [id, cell] of Object.entries(row.cells)) {
      if (!cell.markdown.startsWith('=') || cell.markdown.length < 2) continue;
      const text = `=${rewrite(cell.markdown.slice(1))}`;
      if (text !== cell.markdown) cells = { ...cells, [id]: { ...cell, markdown: text } };
    }
    return cells === row.cells ? row : { ...row, cells };
  });
  const after: TableData = { ...data, columns, rows: out };
  const edited = clone(sheet);
  const rowIds = rows.map((r) => r.id);
  const colIds = columns.map((c) => c.id);
  for (const key of ['cells', 'notes']) moveEntries(edited, key, move, rowIds, colIds);
  moveMerges(edited, merges, move, rowIds, colIds);
  // Names and the formulas of validation and conditional rules read cells too, and their ranges move with the cells.
  rewriteSheetText(edited, rewrite);
  if (!moveRuleRanges(edited, shift, rowIds, colIds)) return null;
  tidy(edited, after, data);
  dropEmpty(edited);
  // Other tables read this one by its name: those references follow the moved cells in the same change.
  const other = (formula: string) => shiftFormula(formula, fshift, { other: book?.name });
  const also = book ? followInOthers(book, other) : [];
  return { data: after, patch: sheetPatch(sheet, edited), ...(also.length > 0 ? { also } : {}) };
}

/** Insert cells: the block's cells and everything below (down) or right of them (right) move over. */
export function insertCells(
  data: TableData,
  sheet: Sheet,
  input: CellBox,
  shift: InsertShift,
  book?: TableBook,
): CellsChange | null {
  const box = clampBox(data, input);
  if (shift === 'down') {
    const n = box.row2 - box.row1 + 1;
    const last = lastUsed(data, sheet, box, true);
    const move = (r: number, c: number): [number, number] =>
      c >= box.col1 && c <= box.col2 && r >= box.row1 ? [r + n, c] : [r, c];
    const need = Math.max(data.rows.length, last + n + 1);
    const s: Shift = { row1: box.row1, col1: box.col1, row2: Infinity, col2: box.col2, dRow: n, dCol: 0 };
    const merges = planMerges(data, sheet, { ...box, row2: Infinity }, null);
    return merges && build(data, sheet, move, s, need, data.columns.length, merges, book);
  }
  const n = box.col2 - box.col1 + 1;
  const last = lastUsed(data, sheet, box, false);
  const move = (r: number, c: number): [number, number] =>
    r >= box.row1 && r <= box.row2 && c >= box.col1 ? [r, c + n] : [r, c];
  const need = Math.max(data.columns.length, last + n + 1);
  const s: Shift = { row1: box.row1, col1: box.col1, row2: box.row2, col2: Infinity, dRow: 0, dCol: n };
  const merges = planMerges(data, sheet, { ...box, col2: Infinity }, null);
  return merges && build(data, sheet, move, s, data.rows.length, need, merges, book);
}

/** Delete cells: the block's cells go, and the cells below (up) or right of them (left) move in. */
export function deleteCells(
  data: TableData,
  sheet: Sheet,
  input: CellBox,
  shift: DeleteShift,
  book?: TableBook,
): CellsChange | null {
  const box = clampBox(data, input);
  const gone = { row1: box.row1, col1: box.col1, row2: box.row2, col2: box.col2 };
  if (shift === 'up') {
    const n = box.row2 - box.row1 + 1;
    const move = (r: number, c: number): [number, number] | null => {
      if (c < box.col1 || c > box.col2 || r < box.row1) return [r, c];
      return r <= box.row2 ? null : [r - n, c];
    };
    const s: Shift = { row1: box.row2 + 1, col1: box.col1, row2: Infinity, col2: box.col2, dRow: -n, dCol: 0, gone };
    const merges = planMerges(data, sheet, { ...box, row1: box.row2 + 1, row2: Infinity }, gone);
    return merges && build(data, sheet, move, s, data.rows.length, data.columns.length, merges, book);
  }
  const n = box.col2 - box.col1 + 1;
  const move = (r: number, c: number): [number, number] | null => {
    if (r < box.row1 || r > box.row2 || c < box.col1) return [r, c];
    return c <= box.col2 ? null : [r, c - n];
  };
  const s: Shift = { row1: box.row1, col1: box.col2 + 1, row2: box.row2, col2: Infinity, dRow: 0, dCol: -n, gone };
  const merges = planMerges(data, sheet, { ...box, col1: box.col2 + 1, col2: Infinity }, gone);
  return merges && build(data, sheet, move, s, data.rows.length, data.columns.length, merges, book);
}
