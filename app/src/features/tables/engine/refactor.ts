// Reference adjustment (DESIGN 6.8). Inserting, deleting, or moving rows and columns rewrites the A1 references in
// formulas, names, and rule formulas, as Excel does.
// - References below an inserted row move down. References right of an inserted column move right.
// - A reference to a deleted cell becomes #REF!.
// - A range grows when rows are inserted inside it and shrinks when rows inside it are deleted. A range whose rows
//   are all deleted becomes #REF!.
// - A moved cell's references follow it.
//
// "$" does not change any of this; it matters only to copying and filling. The rewrite works on the parsed tree and
// replaces only the text of each reference, so everything else in the formula stays exactly as written. Column
// names ([Price]) and structured references name columns, not places, so they never change.

import { children, lettersFromColumn, type CellAbs, type Node } from '../../../core/expr';
import { parseFormula } from './formula/parser';
import type { Cell, Table, TableName } from './model';

/** Rows and columns are zero-based: data row 0 is A1's row 1. */
export type StructureChange =
  | {
      readonly kind: 'insertRows' | 'deleteRows' | 'insertCols' | 'deleteCols';
      readonly at: number;
      readonly count: number;
    }
  | { readonly kind: 'moveRows' | 'moveCols'; readonly from: number; readonly count: number; readonly to: number };

const REF_ERROR = '#REF!';

/** Where an index goes, or null when it was deleted. `to` of a move is where the block starts afterwards. */
function mapIndex(change: StructureChange, i: number): number | null {
  switch (change.kind) {
    case 'insertRows':
    case 'insertCols':
      return i >= change.at ? i + change.count : i;
    case 'deleteRows':
    case 'deleteCols':
      if (i < change.at) return i;
      return i < change.at + change.count ? null : i - change.count;
    default: {
      const { from, count, to } = change;
      if (i >= from && i < from + count) return to + (i - from);
      // Take the block out, then put it back in at `to`.
      const without = i >= from + count ? i - count : i;
      return without >= to ? without + count : without;
    }
  }
}

const isRowChange = (change: StructureChange): boolean => change.kind.endsWith('Rows');

/** A range's first and last index after the change, or null when nothing of it is left. */
function mapSpan(change: StructureChange, first: number, last: number): [number, number] | null {
  if (last === Infinity) return [first, last];
  if (change.kind === 'insertRows' || change.kind === 'insertCols') {
    // Inserting at the first row of a range moves it; inserting inside or just below its first row grows it.
    const a = first >= change.at ? first + change.count : first;
    const b = last >= change.at ? last + change.count : last;
    return [a, b];
  }
  if (change.kind === 'deleteRows' || change.kind === 'deleteCols') {
    const end = change.at + change.count;
    if (first >= change.at && last < end) return null;
    const a = first < change.at ? first : first < end ? change.at : first - change.count;
    const b = last < change.at ? last : last < end ? change.at - 1 : last - change.count;
    return [a, b];
  }
  const a = mapIndex(change, first)!;
  const b = mapIndex(change, last)!;
  return [Math.min(a, b), Math.max(a, b)];
}

function cellText(col: number, row: number, abs?: CellAbs): string {
  return `${abs?.col ? '$' : ''}${lettersFromColumn(col)}${abs?.row ? '$' : ''}${row + 1}`;
}

function rangeText(
  node: Extract<Node, { type: 'range' }>,
  col1: number,
  row1: number,
  col2: number,
  row2: number,
): string {
  const [a, b] = node.abs ?? [undefined, undefined];
  if (row2 === Infinity) {
    const left = `${a?.col ? '$' : ''}${lettersFromColumn(col1)}`;
    return `${left}:${b?.col ? '$' : ''}${lettersFromColumn(col2)}`;
  }
  if (col2 === Infinity) return `${a?.row ? '$' : ''}${row1 + 1}:${b?.row ? '$' : ''}${row2 + 1}`;
  return `${cellText(col1, row1, a)}:${cellText(col2, row2, b)}`;
}

function rewriteCell(node: Extract<Node, { type: 'cell' }>, change: StructureChange): string | null {
  const rows = isRowChange(change);
  const moved = mapIndex(change, rows ? node.row : node.col);
  if (moved === null) return REF_ERROR;
  if (moved === (rows ? node.row : node.col)) return null;
  return rows ? cellText(node.col, moved, node.abs) : cellText(moved, node.row, node.abs);
}

function rewriteRange(node: Extract<Node, { type: 'range' }>, change: StructureChange): string | null {
  const rows = isRowChange(change);
  const span = rows ? mapSpan(change, node.row1, node.row2) : mapSpan(change, node.col1, node.col2);
  if (span === null) return REF_ERROR;
  const [a, b] = span;
  const same = rows ? a === node.row1 && b === node.row2 : a === node.col1 && b === node.col2;
  if (same) return null;
  return rows ? rangeText(node, node.col1, a, node.col2, b) : rangeText(node, a, node.row1, b, node.row2);
}

export interface AdjustOptions {
  /** The table's own name; references qualified with it (Sales!B2 inside Sales) adjust too. */
  tableName?: string;
  /**
   * For a table other than the changed one: the changed table's name. Only references qualified with it adjust,
   * as Sales!B2 does in another table when rows are inserted into Sales.
   */
  otherTable?: string;
}

/**
 * Rewrites the references of a formula (stored form, without "=") for a change of rows or columns. Text that does
 * not parse is returned as it is.
 */
export function adjustFormula(formula: string, change: StructureChange, options: AdjustOptions = {}): string {
  const parsed = parseFormula(formula, undefined, { legacy: false });
  if (!parsed.ok) return formula;
  const edits: { start: number; end: number; text: string }[] = [];
  const own = options.tableName?.toLowerCase();
  const other = options.otherTable?.toLowerCase();
  const visit = (node: Node, qualified: string | null): void => {
    if (node.type === 'qualified') {
      visit(node.ref, node.scope.toLowerCase());
      return;
    }
    const applies = other !== undefined ? qualified === other : qualified === null || qualified === own;
    if (applies && (node.type === 'cell' || node.type === 'range')) {
      const text = node.type === 'cell' ? rewriteCell(node, change) : rewriteRange(node, change);
      if (text !== null) edits.push({ start: node.start, end: node.end, text });
      return;
    }
    if (node.type === 'spill') {
      visit(node.ref, qualified);
      return;
    }
    for (const child of children(node)) visit(child, qualified);
  };
  visit(parsed.node, null);
  if (edits.length === 0) return formula;
  edits.sort((a, b) => b.start - a.start);
  let out = formula;
  for (const edit of edits) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  return out;
}

/** Rewrites the references of defined names. */
export function adjustNames(
  names: readonly TableName[],
  change: StructureChange,
  options: AdjustOptions = {},
): TableName[] {
  return names.map((name) => {
    const ref = adjustFormula(name.ref, change, options);
    return ref === name.ref ? name : { ...name, ref };
  });
}

/** Rewrites every formula of a table: single-cell formulas, calculated columns, and names. */
export function adjustTable(table: Table, change: StructureChange, options: AdjustOptions = {}): Table {
  const opts = { tableName: table.name, ...options };
  let changed = false;
  const columns = table.columns.map((column) => {
    if (column.formula === undefined) return column;
    const formula = adjustFormula(column.formula, change, opts);
    if (formula === column.formula) return column;
    changed = true;
    return { ...column, formula };
  });
  const rows = table.rows.map((row) => {
    let cells: Cell[] | null = null;
    row.cells.forEach((cell, c) => {
      if (cell.formula === undefined) return;
      const formula = adjustFormula(cell.formula, change, opts);
      if (formula === cell.formula) return;
      cells ??= [...row.cells];
      cells[c] = { ...cell, formula, raw: `=${formula}` };
    });
    if (!cells) return row;
    changed = true;
    return { ...row, cells };
  });
  const names = table.names ? adjustNames(table.names, change, opts) : undefined;
  if (names && names.some((n, i) => n !== table.names![i])) changed = true;
  if (!changed) return table;
  return { ...table, columns, rows, ...(names ? { names } : {}) };
}
