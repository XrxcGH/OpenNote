// A page is the workbook (ADR 0062): its tables, in page order, recalculate over one dependency graph, so a formula
// in one table that reads another (Sales[Amount], Sales!B2) recalculates when that table changes. A table's name is
// its `name`, or Table1, Table2, and so on in page order.

import { applyRowChange, makeCell, rowChangeFits, type CellEdit, type RowChange } from './edit';
import { adjustTable } from './refactor';
import type { Locale } from './locale';
import type { Table } from './model';
import { DEFAULT_ENV, Engine, engineOf, rememberEngine, type CycleCell, type EngineEnv } from './recalc';
import type { ErrorOrigin } from './formula/explain';
import type { Box } from './graph';

/** The tables of one page, in page order. */
export type Workbook = readonly Table[];

/** The name each table answers to in references. */
export function tableNames(book: Workbook): string[] {
  return book.map((table, i) => table.name ?? `Table${i + 1}`);
}

/** Recalculates every formula on the page and returns the tables, with unchanged ones kept as they were. */
export function recalculateBook(book: Workbook, env: EngineEnv = DEFAULT_ENV): Table[] {
  const engine = Engine.build(book, env);
  const result = engine.results();
  rememberEngine(result, engine);
  return result;
}

/** Recalculates after an edit of cells in one table, running only the formulas on the page that read them. */
export function recalculateBookCells(
  before: Workbook,
  next: Workbook,
  table: number,
  cells: readonly { row: number; col: number }[],
  env: EngineEnv = DEFAULT_ENV,
): Table[] {
  const known = engineOf(before);
  if (known === undefined || known.env !== env || !known.sameShape(next)) return recalculateBook(next, env);
  const engine = known.fork();
  engine.beginEdit();
  engine.applyCells(
    next,
    cells.map((cell) => ({ ...cell, table })),
  );
  const result = engine.results();
  rememberEngine(result, engine);
  return result;
}

/**
 * Inserts, deletes, or moves rows in one table of the page. Its own formulas and names adjust, and so does every
 * reference to it from the other tables (Sales!B2, Sales[Amount]). Then the page recalculates.
 */
export function changeBookRows(
  book: Workbook,
  table: number,
  change: RowChange,
  env: EngineEnv = DEFAULT_ENV,
): Table[] {
  const target = book[table];
  if (target === undefined || !rowChangeFits(target, change)) return [...book];
  const names = tableNames(book);
  const next = book.map((t, i) =>
    i === table
      ? applyRowChange(adjustTable(t, change, { tableName: names[i] }), change)
      : adjustTable(t, change, { otherTable: names[table] }),
  );
  return recalculateBook(next, env);
}

/** Sets what one cell of one table holds from typed text, and recalculates the page. */
export function setBookCellInput(
  book: Workbook,
  table: number,
  edit: CellEdit,
  locale: Locale,
  env: EngineEnv = DEFAULT_ENV,
): Table[] {
  const target = book[table];
  const column = target?.columns[edit.col];
  if (!column || !target.rows[edit.row] || column.formula !== undefined) return [...book];
  const cell = makeCell(column, edit.raw, locale, true, target);
  const rows = target.rows.map((row, r) => {
    if (r !== edit.row) return row;
    const cells = [...row.cells];
    cells[edit.col] = cell;
    return { ...row, cells };
  });
  const next = book.map((t, i) => (i === table ? { ...t, rows } : t));
  return recalculateBookCells(book, next, table, [{ row: edit.row, col: edit.col }], env);
}

function engineFor(book: Workbook): Engine {
  let engine = engineOf(book);
  if (engine === undefined) {
    engine = Engine.build(book, DEFAULT_ENV);
    rememberEngine(book, engine);
  }
  return engine;
}

/** Where the error in a cell of a table on the page came from. */
export function bookErrorOrigin(book: Workbook, table: number, col: number, row: number): ErrorOrigin | undefined {
  return engineFor(book).originAt(table, col, row);
}

/** The block a formula cell spills into, when it spills. */
export function bookSpillRange(book: Workbook, table: number, col: number, row: number): Box | undefined {
  return engineFor(book).spillAt(table, col, row);
}

/** The formulas on the page that are in a cycle. */
export function bookCycles(book: Workbook): CycleCell[] {
  return engineFor(book).cycleCells();
}
