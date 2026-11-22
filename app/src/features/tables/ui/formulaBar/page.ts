// The page a table is on, as the formula bar reads it. It gives every table's cells before calculation, in page
// order (the page's workbook, smart/book.ts). It lists the names and tables a formula may use. It also works out
// part of a formula in the active cell's place, for Evaluate formula.
import type { TableExtraHost } from '../../../page';
import { setBookCellInput } from '../../engine/workbook';
import type { Value } from '../../engine/values';
import { bookFor } from '../../smart/book';
import { appLocale } from '../../smart/locale';
import type { CompleteContext } from './complete';
import type { PageTables } from './origin';

/** The tables of the host's page, or null when the host's table is not one of them yet. */
export function pageTables(host: TableExtraHost): PageTables | null {
  const members = bookFor(host.page).ordered();
  const own = members.findIndex((member) => member.element === host.element);
  if (own < 0) return null;
  const raws = members.map((member) => member.raw());
  return { raws, own, names: raws.map((raw) => raw.name ?? '') };
}

/** The names, tables, and columns a formula in the table may use, for autocomplete. */
export function completeContext(page: PageTables | null): CompleteContext {
  if (!page) return {};
  const names = page.raws.flatMap((raw, i) =>
    (raw.names ?? []).filter((n) => n.scope === 'page' || i === page.own).map((n) => ({ name: n.name, ref: n.ref })),
  );
  const tables = page.raws.flatMap((raw) =>
    raw.name ? [{ name: raw.name, columns: raw.columns.map((column) => column.name) }] : [],
  );
  return { names, tables };
}

/** Works out formula text (without "=") as if it were typed in the cell at data row `row`, column `col`. */
export function evaluatorFor(page: PageTables, col: number, row: number): (formula: string) => Value {
  return (formula) => {
    const book = setBookCellInput(page.raws, page.own, { row, col, raw: `=${formula}` }, appLocale());
    return book[page.own]?.rows[row]?.cells[col]?.value ?? null;
  };
}
