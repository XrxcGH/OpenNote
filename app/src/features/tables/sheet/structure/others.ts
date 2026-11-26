// The patches of the other tables on the page when a change of this table moves what their formulas read (Sales!B2).

import type { TableBook, TableChange } from '../../../../editor/commands/tables';
import type { TableData } from '../../../../editor/schema/specs';
import { normalizeTableData } from '../../../../editor/table/mapping';
import { clone } from '../model/json';
import { readSheet, sheetPatch } from '../model/sheet';
import { rewriteCells, rewriteSheetText } from './reflow';

/**
 * The patches of the other tables whose formulas, names, or rules `rewrite` changes. `rewrite` adjusts only references
 * that name the changed table, so tables that do not read it give no patch.
 */
export function followInOthers(
  book: TableBook,
  rewrite: (formula: string) => string,
): NonNullable<TableChange['also']> {
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
