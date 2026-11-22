// Find in a table: the cells whose text holds the query. Plugs into the Find bar's search the way a text box does.
// A search looks at values (what the cell holds) or at formulas (the text of formulas only), in whole cells or parts,
// and lists matches by rows or by columns.

import { EN_US, makeCell, recalculateCells, type Cell, type EngineEnv, type Locale, type Table } from '../../tables';
import { findInTexts } from './match';
import type { FindOptions, TextRange } from './match';

export interface TableScope {
  /** 'values' searches what cells hold; 'formulas' searches the text of formulas, and no other cell. */
  within: 'values' | 'formulas';
  /** The whole cell must match, as in Excel's "Match entire cell contents". */
  entireCell?: boolean;
  caseSensitive?: boolean;
  /** The order of the matches: across each row first (default), or down each column first. */
  order?: 'rows' | 'columns';
  regex?: boolean;
  wildcards?: boolean;
}

export interface TableMatch {
  row: number;
  column: number;
  /** The text searched: the cell's value text, or its formula with the leading "=". */
  text: string;
  ranges: TextRange[];
}

/** The text of a cell as a search sees it, or null when this scope does not search the cell. */
export function cellText(table: Table, row: number, column: number, within: 'values' | 'formulas'): string | null {
  const col = table.columns[column];
  const cell = table.rows[row]?.cells[column];
  if (!col || !cell) return null;
  const formula = cell.formula ?? col.formula;
  if (within === 'formulas') return formula === undefined ? null : `=${formula}`;
  return cell.raw !== '' && cell.formula === undefined ? cell.raw : cell.value === null ? '' : String(cell.value);
}

export function searchTable(table: Table, query: string, scope: TableScope): TableMatch[] {
  if (query === '') return [];
  const options: FindOptions = {
    caseSensitive: scope.caseSensitive ?? false,
    wholeWord: false,
    regex: scope.regex,
    wildcards: scope.wildcards,
  };
  // Collect the searchable cells in match order, then compile the pattern once for all of them.
  const spots: { row: number; column: number; text: string }[] = [];
  const visit = (row: number, column: number): void => {
    const text = cellText(table, row, column, scope.within);
    if (text !== null && text !== '') spots.push({ row, column, text });
  };
  if (scope.order === 'columns') {
    for (let c = 0; c < table.columns.length; c++) for (let r = 0; r < table.rows.length; r++) visit(r, c);
  } else {
    for (let r = 0; r < table.rows.length; r++) for (let c = 0; c < table.columns.length; c++) visit(r, c);
  }
  const all = findInTexts(
    spots.map((x) => x.text),
    query,
    options,
  );
  const found: TableMatch[] = [];
  spots.forEach((spot, k) => {
    const ranges = scope.entireCell ? all[k].filter((r) => r.start === 0 && r.end === spot.text.length) : all[k];
    if (ranges.length > 0) found.push({ ...spot, ranges });
  });
  return found;
}

/**
 * Replaces every match in the table, each through the same input path as typing, so formulas are read again and the
 * table recalculates. Returns one new table, so the host stores one undo step. Calculated columns are skipped. The
 * cells change together and the table recalculates once.
 */
export function replaceInTable(
  table: Table,
  query: string,
  replacement: string,
  scope: TableScope,
  locale: Locale = EN_US,
  env?: EngineEnv,
): { table: Table; replaced: number } {
  let replaced = 0;
  const edits = new Map<number, Map<number, Cell>>();
  for (const match of searchTable(table, query, scope)) {
    const cell = table.rows[match.row].cells[match.column];
    const column = table.columns[match.column];
    if (column.formula !== undefined) continue;
    if (scope.within === 'values' && cell.formula !== undefined) continue;
    let text = '';
    let from = 0;
    for (const range of match.ranges) {
      text += match.text.slice(from, range.start) + replacement;
      from = range.end;
      replaced++;
    }
    text += match.text.slice(from);
    const row = edits.get(match.row) ?? new Map<number, Cell>();
    row.set(match.column, makeCell(column, text, locale, true, table));
    edits.set(match.row, row);
  }
  if (replaced === 0) return { table, replaced };
  const rows = table.rows.map((r, i) => {
    const row = edits.get(i);
    if (!row) return r;
    const cells = [...r.cells];
    for (const [c, cell] of row) cells[c] = cell;
    return { ...r, cells };
  });
  const refs = [...edits].flatMap(([row, cols]) => [...cols.keys()].map((col) => ({ row, col })));
  return { table: recalculateCells(table, { ...table, rows }, refs, env), replaced };
}
