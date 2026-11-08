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
import { readSheet } from '../model/sheet';
import { applyStructureOp } from './ops';
import { followInOthers } from './others';
import { reflowSheet, rewriteCells } from './reflow';

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
  const also = book ? followInOthers(book, (formula) => adjustFormula(formula, change, { otherTable: book.name })) : [];
  return {
    ...applied,
    data,
    ...(sheet.patch ? { extra: sheet.patch } : {}),
    ...(also.length > 0 ? { also } : {}),
  };
}

export const structureHooks: TableHooks = { structure: applyStructureOp, follow: followReferences };

setTableHooks(structureHooks);
