// A new table block from pasted spreadsheet cells (ADR 0067): what the page's paste makes of a table copied from
// Excel, Google Sheets, LibreOffice, or another OpenNote table, with formulas, number formats, styles, merges, and
// column widths. The page's paste pipeline calls this through features/page/paste/tables.ts.

import { isEnabled } from '../../../app/flags';
import type { TableData } from '../../../editor/schema/specs';
import { DEFAULT_COLUMN_WIDTH } from '../../../editor/schema/specs';
import { readClip } from '../engine/paste/clip';
import type { Clip } from '../engine/paste/clip';
import { planPaste } from './plan';
import { PASTE_ALL } from './special';

/** Whether a pasted clip's first row is its column titles: an OpenNote header row, or th and bold cells only. */
function clipHeader(clip: Clip): boolean {
  if (clip.rows.length < 2) return false;
  if (clip.link) return clip.link.header && clip.link.top === 0;
  const first = clip.rows[0];
  return first.some((cell) => cell.text.trim() !== '') && first.every((cell) => cell.header || cell.text.trim() === '');
}

/**
 * Table data with its sheet (`data.sheet`) from a spreadsheet's clipboard HTML: Excel, Google Sheets, LibreOffice, or
 * an OpenNote table copy. Returns null for any other HTML, and while `tables.sheetWrites` is off.
 */
export function spreadsheetTableData(html: string, newId: () => string): (TableData & { sheet?: unknown }) | null {
  // Styles, merges, and notes are sheet writes, and merges and notes are version 2 content (NEXT-PLAN 3.1). With the
  // flag off, the page's own table reading runs instead.
  if (!isEnabled('tables.sheetWrites')) return null;
  const clip = readClip({ html });
  if (!clip || clip.source === 'html' || clip.source === 'delimited') return null;
  const height = clip.rows.length;
  const width = clip.rows[0]?.length ?? 0;
  if (height * width < 2) return null;
  const columns = Array.from({ length: width }, () => ({ id: newId(), width: DEFAULT_COLUMN_WIDTH }));
  const empty: TableData = {
    header: clipHeader(clip),
    columns,
    rows: Array.from({ length: height }, () => ({
      id: newId(),
      cells: Object.fromEntries(columns.map((column) => [column.id, { markdown: '' }])),
    })),
  };
  const box = { top: 0, left: 0, bottom: height - 1, right: width - 1 };
  const plan = planPaste({ table: empty, sheet: {}, box }, clip, { ...PASTE_ALL, what: 'all' }, { newId });
  if (!plan) return null;
  if (clip.widths.some((w) => w !== null)) {
    plan.table.columns = plan.table.columns.map((column, i) => {
      const w = clip.widths[i];
      return typeof w === 'number' ? { ...column, width: Math.round(Math.max(24, Math.min(w, 2000))) } : column;
    });
  }
  const sheet = plan.patch?.sheet;
  return sheet ? { ...plan.table, sheet } : plan.table;
}
