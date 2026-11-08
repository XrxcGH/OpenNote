// Reference adjustment on structure changes (DESIGN 6.8). When rows or columns are inserted, deleted, or moved, the
// A1 references in every formula cell, in names, and in rule formulas follow, through the engine's `adjustFormula`.
// Merges and rule ranges name rows and columns by ID, so the sheet model's `tidy` moves their corners.
// Insert cells and delete cells move a block, so `shiftFormula` does the same for references into that block.

import { children, lettersFromColumn, type CellAbs, type Node } from '../../../../core/expr';
import { parseFormula } from '../../engine/formula/parser';
import { clone, isObject, ownObject, put, type JsonObject } from '../model/json';
import { sheetPatch, tidy } from '../model/sheet';
import type { Sheet, TableLike } from '../model/types';
import { dropEmpty } from './edit';

/** A cell's markdown is a formula when it starts with "=". */
const isFormula = (markdown: string): boolean => markdown.startsWith('=') && markdown.length > 1;

type Rewrite = (formula: string) => string;

/** Applies `rewrite` to the stored form of a text that may start with "=". */
function viaEquals(text: string, rewrite: Rewrite): string {
  return text.startsWith('=') ? `=${rewrite(text.slice(1))}` : rewrite(text);
}

/** The rows of `data` with every formula cell rewritten; rows without formulas keep their identity. */
export function rewriteCells<T extends { cells: Record<string, { markdown: string }> }>(
  rows: readonly T[],
  rewrite: Rewrite,
): T[] {
  return rows.map((row) => {
    let cells: Record<string, { markdown: string }> | null = null;
    for (const [col, cell] of Object.entries(row.cells)) {
      if (!isFormula(cell.markdown)) continue;
      const next = `=${rewrite(cell.markdown.slice(1))}`;
      if (next === cell.markdown) continue;
      cells ??= { ...row.cells };
      cells[col] = { ...cell, markdown: next };
    }
    return cells ? ({ ...row, cells } as T) : row;
  });
}

/** The formulas of names and rules rewritten in place. */
export function rewriteSheetText(sheet: Sheet, rewrite: Rewrite): void {
  const names = ownObject(sheet, 'names');
  if (names) {
    for (const key of Object.keys(names)) {
      const entry = ownObject(names, key);
      if (entry && typeof entry.ref === 'string') entry.ref = viaEquals(entry.ref, rewrite);
    }
  }
  const touch = (rule: JsonObject, keys: readonly string[]) => {
    for (const key of keys) if (typeof rule[key] === 'string') rule[key] = viaEquals(rule[key] as string, rewrite);
  };
  const validation = ownObject(sheet, 'validation');
  if (validation) {
    for (const id of Object.keys(validation)) {
      const rule = ownObject(validation, id);
      if (rule) touch(rule, ['a', 'b', 'source']);
    }
  }
  const conditional = ownObject(sheet, 'conditional');
  if (conditional) {
    for (const id of Object.keys(conditional)) {
      const rule = ownObject(conditional, id);
      if (!rule) continue;
      touch(rule, ['a', 'b']);
      const stops = Array.isArray(rule.stops) ? rule.stops : [];
      for (const stop of stops) if (isObject(stop) && stop.at === 'formula') touch(stop, ['value']);
      for (const end of ['min', 'max']) {
        const one = ownObject(rule, end);
        if (one && one.at === 'formula') touch(one, ['value']);
      }
    }
  }
}

/**
 * Brings the sheet up to date after a change of rows or columns. Names and rule formulas are adjusted. Merges and rule
 * ranges move by ID. Orphans and unused styles go. The result also holds the data patch (null when nothing changed).
 */
export function reflowSheet(
  sheet: Sheet,
  before: TableLike,
  after: TableLike,
  rewrite: Rewrite | null,
): { sheet: Sheet; patch: JsonObject | null } {
  const next = clone(sheet);
  if (rewrite) rewriteSheetText(next, rewrite);
  // Cached results go stale by themselves: the fingerprint of the cells' text no longer matches (R-SHT-18).
  tidy(next, after, before);
  dropEmpty(next);
  return { sheet: next, patch: sheetPatch(sheet, next) };
}

/** The cells that move for Insert cells and Delete cells: columns `col1` to `col2`, from `row1` down (or rows across). */
export interface Shift {
  /** The first and last row and column of the block that moves, zero-based, `Infinity` for the table's end. */
  row1: number;
  col1: number;
  row2: number;
  col2: number;
  /** How far the block moves: rows down (negative: up) and columns right (negative: left). */
  dRow: number;
  dCol: number;
  /** Cells that Delete cells removed: a reference to one of them becomes #REF!. */
  gone?: { row1: number; col1: number; row2: number; col2: number };
}

const inside = (s: Shift, row: number, col: number): boolean =>
  row >= s.row1 && row <= s.row2 && col >= s.col1 && col <= s.col2;

const removed = (s: Shift, row: number, col: number): boolean =>
  s.gone !== undefined && row >= s.gone.row1 && row <= s.gone.row2 && col >= s.gone.col1 && col <= s.gone.col2;

function cellText(col: number, row: number, abs?: CellAbs): string {
  return `${abs?.col ? '$' : ''}${lettersFromColumn(col)}${abs?.row ? '$' : ''}${row + 1}`;
}

/** A range's first and last index after lines `at` onward are inserted (count > 0) or `-count` lines are deleted. */
export function mapSpan(first: number, last: number, at: number, count: number): [number, number] | null {
  if (count > 0) return [first >= at ? first + count : first, last >= at ? last + count : last];
  const n = -count;
  const end = at + n;
  if (first >= at && last < end) return null;
  const a = first < at ? first : first < end ? at : first - n;
  const b = last < at ? last : last < end ? at - 1 : last - n;
  return [a, b];
}

/**
 * A range inside the block band changes as inserted and deleted lines change it. Its first and last index follow,
 * so it grows or shrinks, as in Excel. The band is the columns of a down or up shift, or the rows of a right or left
 * shift. A range that only partly crosses the band stays as it is.
 */
function shiftRange(node: Extract<Node, { type: 'range' }>, s: Shift): string | null {
  const vertical = s.dCol === 0;
  const lo = vertical ? node.col1 : node.row1;
  const hi = vertical ? node.col2 : node.row2;
  const bandLo = vertical ? s.col1 : s.row1;
  const bandHi = vertical ? s.col2 : s.row2;
  const first = vertical ? node.row1 : node.col1;
  const last = vertical ? node.row2 : node.col2;
  if (![lo, hi, first, last].every(Number.isFinite) || lo < bandLo || hi > bandHi) return null;
  const count = vertical ? s.dRow : s.dCol;
  const start = vertical ? s.row1 : s.col1;
  // An insert starts at the first moved cell. A delete starts where the removed cells start.
  const span = mapSpan(first, last, count > 0 ? start : start + count, count);
  if (span === null) return '#REF!';
  if (span[0] === first && span[1] === last) return null;
  const [a, b] = node.abs ?? [undefined, undefined];
  return vertical
    ? `${cellText(node.col1, span[0], a)}:${cellText(node.col2, span[1], b)}`
    : `${cellText(span[0], node.row1, a)}:${cellText(span[1], node.row2, b)}`;
}

/**
 * Rewrites the references into a moved block. A cell inside follows it. A range follows by the rules above. In the
 * table itself (`own`, its name) the plain references follow, and so do those qualified with its name. In another table
 * (`other`, the moved table's name) only the references qualified with that name follow.
 */
export function shiftFormula(formula: string, s: Shift, names: { own?: string; other?: string } = {}): string {
  const parsed = parseFormula(formula, undefined, { legacy: false });
  if (!parsed.ok) return formula;
  const edits: { start: number; end: number; text: string }[] = [];
  const own = names.own?.toLowerCase();
  const other = names.other?.toLowerCase();
  const matches = (scope: string): boolean => scope.toLowerCase() === (other ?? own);
  const visit = (node: Node, qualified: boolean): void => {
    if (node.type === 'qualified') return visit(node.ref, !matches(node.scope));
    if (node.type === 'spill') return visit(node.ref, qualified);
    if (!qualified && node.type === 'cell' && removed(s, node.row, node.col)) {
      edits.push({ start: node.start, end: node.end, text: '#REF!' });
      return;
    }
    if (!qualified && node.type === 'cell' && inside(s, node.row, node.col)) {
      edits.push({ start: node.start, end: node.end, text: cellText(node.col + s.dCol, node.row + s.dRow, node.abs) });
      return;
    }
    if (!qualified && node.type === 'range') {
      const text = shiftRange(node, s);
      if (text !== null) edits.push({ start: node.start, end: node.end, text });
      return;
    }
    for (const child of children(node)) visit(child, qualified);
  };
  visit(parsed.node, other !== undefined);
  edits.sort((a, b) => b.start - a.start);
  let out = formula;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/** Moves entries of a row-by-column map of the sheet (`cells`, `notes`) by IDs, for Insert cells and Delete cells. */
export function moveEntries(
  sheet: Sheet,
  key: string,
  move: (rowIndex: number, colIndex: number) => [number, number] | null,
  rowIds: readonly string[],
  colIds: readonly string[],
): void {
  const map = ownObject(sheet, key);
  if (!map) return;
  const rowAt = new Map(rowIds.map((id, i) => [id, i]));
  const colAt = new Map(colIds.map((id, i) => [id, i]));
  const moved: { row: number; col: number; value: JsonObject[string] }[] = [];
  const next: JsonObject = {};
  for (const rid of Object.keys(map)) {
    const byCol = ownObject(map, rid);
    const r = rowAt.get(rid);
    if (!byCol || r === undefined) continue;
    for (const cid of Object.keys(byCol)) {
      const c = colAt.get(cid);
      if (c === undefined) continue;
      const to = move(r, c);
      if (to) moved.push({ row: to[0], col: to[1], value: byCol[cid] });
    }
  }
  for (const m of moved) {
    const rid = rowIds[m.row];
    const cid = colIds[m.col];
    if (rid === undefined || cid === undefined) continue; // moved off the table
    let byCol = ownObject(next, rid);
    if (!byCol) {
      byCol = {};
      put(next, rid, byCol);
    }
    put(byCol, cid, m.value);
  }
  if (Object.keys(next).length === 0) delete sheet[key];
  else sheet[key] = next;
}
