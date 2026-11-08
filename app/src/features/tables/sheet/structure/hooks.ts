// Plugs the structure commands into the table commands of the editor (editor/commands/tables.ts): the editor keeps
// the grid, and this runs the structure ops and brings references, names, rules, merges, and ranges along when lines
// are inserted, deleted, or moved. Importing this file registers them.

import {
  setTableHooks,
  type LineChange,
  type TableBook,
  type TableChange,
  type TableHooks,
} from '../../../../editor/commands/tables';
import type { TableData } from '../../../../editor/schema/specs';
import { adjustFormula } from '../../engine/refactor';
import { normalizeTableData } from '../../../../editor/table/mapping';
import { clone } from '../model/json';
import { readSheet, sheetPatch } from '../model/sheet';
import { applyStructureOp } from './ops';
import { reflowSheet, rewriteCells, rewriteSheetText } from './reflow';

/**
 * Rewrites the formulas of the cells, names, and rules for `change`, and moves merges and ranges by their IDs. With the
 * page's tables, the references into this table from the others (Sales!B2) follow too, and those tables' patches go
 * with the change.
 */
export function followReferences(
  before: TableData,
  applied: TableChange,
  change: LineChange,
  stored: unknown,
  book?: TableBook,
): TableChange {
  const rewrite = (formula: string) => adjustFormula(formula, change, book ? { tableName: book.name } : {});
  const rows = rewriteCells(applied.data.rows, rewrite);
  const data = { ...applied.data, rows };
  const sheet = reflowSheet(readSheet({ sheet: stored }), before, data, rewrite);
  const also = book ? followInOthers(book, change) : [];
  return {
    ...applied,
    data,
    ...(sheet.patch ? { extra: sheet.patch } : {}),
    ...(also.length > 0 ? { also } : {}),
  };
}

/** The patches of the other tables whose formulas, names, or rules read the changed table by its name. */
function followInOthers(book: TableBook, change: LineChange): NonNullable<TableChange['also']> {
  const rewrite = (formula: string) => adjustFormula(formula, change, { otherTable: book.name });
  const out: NonNullable<TableChange['also']> = [];
  for (const other of book.others) {
    const table = normalizeTableData(other.data as TableData);
    const rows = rewriteCells(table.rows, rewrite);
    const patch: Record<string, unknown> = {};
    if (rows.some((row, i) => row !== table.rows[i])) patch.rows = rows;
    const sheet = readSheet(other.data);
    const edited = clone(sheet);
    rewriteSheetText(edited, rewrite);
    Object.assign(patch, sheetPatch(sheet, edited) ?? {});
    if (Object.keys(patch).length > 0) out.push({ block: other.block, data: patch });
  }
  return out;
}

export const structureHooks: TableHooks = { structure: applyStructureOp, follow: followReferences };

setTableHooks(structureHooks);
