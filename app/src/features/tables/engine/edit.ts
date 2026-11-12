// Table edits. Each returns a new table, recalculated, so the cached results always match the inputs. A formula with
// a syntax error or a cycle is refused and the old table is kept, as the Phase 7 design requires.

import { toCanonical } from './canonical';
import { convertFormula, STORED, syntaxOf, type FormulaProblem } from './formula/lexer';
import { parseFormula } from './formula/parser';
import type { Locale } from './locale';
import { EMPTY_CELL, parseInput, type Cell, type Column, type ColumnType, type Row, type Table } from './model';
import {
  calculateNow,
  DEFAULT_ENV,
  recalculate,
  recalculateCells,
  recalculateWithCycles,
  type EngineEnv as Env,
} from './recalc';
import { adjustTable, wholeChange } from './refactor';

export interface ColumnInit extends Partial<Column> {
  name: string;
}

/** The part of a table that decides which rules its formulas follow: Excel's with data.sheet.v, else the old ones. */
export type SheetRules = Pick<Table, 'sheetVersion'>;

/** True for a table whose formulas keep the textbook rules (formula/legacy.ts). No table means quick math's rules. */
function isLegacy(table?: SheetRules): boolean {
  return table?.sheetVersion === undefined;
}

/**
 * Checks typed formula text (without the "=") in the person's syntax, under the rules of the table it goes in, so a
 * formula is checked by the same rules recalc computes it with. Returns the stored form, or what's wrong.
 */
export function checkFormulaInput(text: string, locale: Locale, table?: SheetRules): string | FormulaProblem {
  const stored = convertFormula(text, syntaxOf(locale), STORED);
  if (typeof stored !== 'string') return stored;
  const parsed = parseFormula(stored, undefined, { legacy: isLegacy(table) });
  return parsed.ok ? stored : parsed.problem;
}

/**
 * Makes one cell from typed text. With `allowFormula`, text that starts with "=" and reads as a formula becomes one,
 * kept in stored form. Pasted text never passes it, so a pasted "=1+1" stays text, as does "=1+" typed by hand.
 */
export function makeCell(column: Column, raw: string, locale: Locale, allowFormula: boolean, table?: SheetRules): Cell {
  if (column.formula !== undefined) return EMPTY_CELL;
  if (allowFormula && raw.startsWith('=')) {
    const stored = checkFormulaInput(raw.slice(1), locale, table);
    if (typeof stored === 'string') return { raw, value: null, formula: stored };
  }
  return { raw, value: parseInput(column, raw, locale) };
}

function nextRowId(rows: readonly Row[]): string {
  let max = -1;
  for (const row of rows) max = Math.max(max, Number(/^r(\d+)$/.exec(row.id)?.[1] ?? -1));
  return `r${max + 1}`;
}

/** Builds a table. Give `sheetVersion` (the table's data.sheet.v) when it has one, so it follows Excel's rules. */
export function createTable(
  inits: readonly ColumnInit[],
  data: readonly (readonly string[])[],
  locale: Locale,
  env: Env = DEFAULT_ENV,
  sheetVersion?: number,
): Table {
  const rules: SheetRules = sheetVersion === undefined ? {} : { sheetVersion };
  const columns: Column[] = inits.map((init, i) => ({ id: `c${i}`, type: 'text', ...init }));
  const rows: Row[] = data.map((line, r) => ({
    id: `r${r}`,
    cells: columns.map((column, c) => makeCell(column, line[c] ?? '', locale, true, rules)),
  }));
  return recalculate({ columns, rows, ...rules }, env);
}

function replaceCell(table: Table, row: number, col: number, cell: Cell): Table {
  const rows = table.rows.map((r, i) => {
    if (i !== row) return r;
    const cells = [...r.cells];
    cells[col] = cell;
    return { ...r, cells };
  });
  return { ...table, rows };
}

export interface CellEdit {
  row: number;
  col: number;
  /** The text as typed. */
  raw: string;
}

/** Sets what a cell holds from typed text. Cells of a calculated column can't be typed into. */
export function setCellInput(table: Table, edit: CellEdit, locale: Locale, env?: Env): Table {
  const { row, col, raw } = edit;
  const column = table.columns[col];
  if (!column || !table.rows[row] || column.formula !== undefined) return table;
  const next = replaceCell(table, row, col, makeCell(column, raw, locale, true, table));
  return recalculateCells(table, next, [{ row, col }], env);
}

export function addRow(table: Table, line: readonly string[], locale: Locale, env?: Env): Table {
  const cells = table.columns.map((column, c) => makeCell(column, line[c] ?? '', locale, true, table));
  return recalculate({ ...table, rows: [...table.rows, { id: nextRowId(table.rows), cells }] }, env);
}

/** Deletes a row. References to it become #REF!, and references below it move up (refactor.ts). */
export function deleteRow(table: Table, row: number, env?: Env): Table {
  return deleteRows(table, row, 1, env);
}

/** Deletes `count` rows from `at`, rewriting references as Excel does. */
export function deleteRows(table: Table, at: number, count: number, env?: Env): Table {
  const change: RowChange = { kind: 'deleteRows', at, count };
  return rowChangeFits(table, change) ? recalculate(applyRowChange(adjustTable(table, change), change), env) : table;
}

/**
 * Deletes every row in `indices` at once. References are rewritten in one pass and the table recalculates once, so
 * the cost does not grow with the number of separate runs. Indices out of range or repeated are ignored.
 */
export function deleteRowSet(table: Table, indices: readonly number[], env?: Env): Table {
  const rows = [...new Set(indices)].filter((i) => Number.isInteger(i) && i >= 0 && i < table.rows.length);
  if (rows.length === 0) return table;
  rows.sort((x, y) => x - y);
  const gone = new Set(rows);
  const adjusted = adjustTable(table, { kind: 'deleteRowSet', rows });
  return recalculate({ ...adjusted, rows: adjusted.rows.filter((_, i) => !gone.has(i)) }, env);
}

/** Inserts `count` empty rows before row `at`, rewriting references as Excel does. */
export function insertRows(table: Table, at: number, count = 1, env?: Env): Table {
  const change: RowChange = { kind: 'insertRows', at, count };
  return rowChangeFits(table, change) ? recalculate(applyRowChange(adjustTable(table, change), change), env) : table;
}

/** Moves `count` rows from `from` so they start at `to` in the result, and their references follow them. */
export function moveRows(table: Table, from: number, count: number, to: number, env?: Env): Table {
  const change: RowChange = { kind: 'moveRows', from, count, to };
  return rowChangeFits(table, change) ? recalculate(applyRowChange(adjustTable(table, change), change), env) : table;
}

/** A change of a table's rows. */
export type RowChange =
  | { readonly kind: 'insertRows'; readonly at: number; readonly count: number }
  | { readonly kind: 'deleteRows'; readonly at: number; readonly count: number }
  | { readonly kind: 'moveRows'; readonly from: number; readonly count: number; readonly to: number };

/** True when the change does something and its rows are in the table. Indexes must be whole numbers. */
export function rowChangeFits(table: Table, change: RowChange): boolean {
  const n = table.rows.length;
  if (!wholeChange(change)) return false;
  if (change.kind === 'insertRows') return change.at >= 0 && change.at <= n;
  if (change.kind === 'deleteRows') return change.at >= 0 && change.at < n;
  const { from, count, to } = change;
  return from >= 0 && from + count <= n && to >= 0 && to + count <= n && to !== from;
}

/** The table's rows after the change, without touching formulas. adjustTable rewrites them. */
export function applyRowChange(table: Table, change: RowChange): Table {
  const rows = table.rows;
  if (change.kind === 'deleteRows') {
    const { at, count } = change;
    return { ...table, rows: rows.filter((_, i) => i < at || i >= at + count) };
  }
  if (change.kind === 'insertRows') {
    let id = Number(/^r(\d+)$/.exec(nextRowId(rows))?.[1] ?? rows.length);
    const blank = (): Row => ({ id: `r${id++}`, cells: table.columns.map(() => EMPTY_CELL) });
    const fresh = Array.from({ length: change.count }, blank);
    return { ...table, rows: [...rows.slice(0, change.at), ...fresh, ...rows.slice(change.at)] };
  }
  const { from, count, to } = change;
  const block = rows.slice(from, from + count);
  const rest = [...rows.slice(0, from), ...rows.slice(from + count)];
  return { ...table, rows: [...rest.slice(0, to), ...block, ...rest.slice(to)] };
}

/** Recalculates everything now, as F9 does for a table in manual calculation. */
export function calculateTable(table: Table, env?: Env): Table {
  return calculateNow(table, env);
}

function withColumn(table: Table, col: number, change: Partial<Column>): Table {
  const columns = table.columns.map((c, i) => (i === col ? { ...c, ...change } : c));
  return { ...table, columns };
}

/** Changes a column's type and reads every typed cell again in the new type. */
export function setColumnType(table: Table, col: number, type: ColumnType, locale: Locale, env?: Env): Table {
  if (!table.columns[col]) return table;
  const next = withColumn(table, col, { type });
  const column = next.columns[col];
  const rows = next.rows.map((row) => {
    const cell = row.cells[col];
    if (column.formula !== undefined || cell.formula !== undefined) return row;
    const cells = [...row.cells];
    cells[col] = { raw: cell.raw, value: parseInput(column, cell.raw, locale) };
    return { ...row, cells };
  });
  return recalculate({ ...next, rows }, env);
}

export type FormulaResult = { ok: true; table: Table } | { ok: false; problem: FormulaProblem };

/**
 * Sets, or with undefined clears, a column's formula, given in stored form. Clearing keeps the last results as
 * plain values. A formula that can't be read, or that would use its own result, is refused.
 */
export function setColumnFormula(table: Table, col: number, formula: string | undefined, env?: Env): FormulaResult {
  if (!table.columns[col]) return { ok: false, problem: { message: 'That column is gone.', pos: 0 } };
  if (formula === undefined) return { ok: true, table: clearFormula(table, col) };
  const parsed = parseFormula(formula, undefined, { legacy: isLegacy(table) });
  if (!parsed.ok) return { ok: false, problem: parsed.problem };
  const base = withColumn(table, col, { formula });
  const rows = base.rows.map((row) => {
    const cells = [...row.cells];
    cells[col] = EMPTY_CELL;
    return { ...row, cells };
  });
  const result = recalculateWithCycles({ ...base, rows }, env);
  if (result.cycles.some((cycle) => cycle.col === col)) {
    const name = table.columns[col].name;
    return { ok: false, problem: { message: `This formula uses its own result through ${name}.`, pos: 0 } };
  }
  return { ok: true, table: result.table };
}

function clearFormula(table: Table, col: number): Table {
  const column = { ...table.columns[col] };
  delete column.formula;
  const columns = table.columns.map((c, i) => (i === col ? column : c));
  const rows = table.rows.map((row) => {
    const cells = [...row.cells];
    cells[col] = { raw: toCanonical(column.type, cells[col].value), value: cells[col].value };
    return { ...row, cells };
  });
  return { ...table, columns, rows };
}
