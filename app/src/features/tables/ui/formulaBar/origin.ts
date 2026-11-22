// Where the error in a cell came from, on the page the table is on. The page's tables are calculated as one workbook
// (smart/book.ts). The origin is read from an engine built for the same tables. So a cell that reads an error from
// another cell can be followed back to the formula that made it (Trace error).
import { bookErrorOrigin } from '../../engine/workbook';
import type { ErrorOrigin, OriginCell } from '../../engine/formula/explain';
import type { Table } from '../../engine';
import { lettersOf } from './scan';

export interface PageTables {
  /** The tables of the page in order, with their formulas still to run. */
  readonly raws: readonly Table[];
  /** Which of them is the table the bar shows. */
  readonly own: number;
  /** Each table's name, as formulas use it, or "" when it has none. */
  readonly names: readonly string[];
}

export interface Traced {
  readonly origin: ErrorOrigin;
  /** The cell the origin belongs to: the first formula that made the error. */
  readonly cell: OriginCell;
  /** The cell's formula in stored form, without "=", or "" when it has none. */
  readonly formula: string;
}

const HOPS = 64;

const formulaOf = (raw: Table | undefined, cell: OriginCell): string => {
  const typed = raw?.rows[cell.row]?.cells[cell.col];
  if (!typed) return '';
  if (typed.formula !== undefined) return typed.formula;
  return typed.raw.startsWith('=') ? typed.raw.slice(1) : '';
};

/** The origin of the error in a cell (data row, zero-based), and the cell it starts in after following other cells. */
export function traceError(page: PageTables, col: number, row: number): { first?: Traced; last?: Traced } {
  const at = (cell: OriginCell): Traced | undefined => {
    const origin = bookErrorOrigin(page.raws as Table[], cell.table, cell.col, cell.row);
    return origin ? { origin, cell, formula: formulaOf(page.raws[cell.table], cell) } : undefined;
  };
  const first = at({ table: page.own, col, row });
  let last = first;
  for (let hop = 0; hop < HOPS && last?.origin.kind === 'cell' && last.origin.cell; hop += 1) {
    const next = at(last.origin.cell);
    if (!next) break;
    last = next;
  }
  return { ...(first ? { first } : {}), ...(last ? { last } : {}) };
}

/** A cell on the page as people read it: "B2" in the bar's own table, "Table2!B2" in another. */
export function originCellName(page: PageTables): (cell: OriginCell) => string {
  return (cell) => {
    const address = `${lettersOf(cell.col)}${cell.row + 1}`;
    if (cell.table === page.own) return address;
    const name = page.names[cell.table] || `Table${cell.table + 1}`;
    return `${name}!${address}`;
  };
}
