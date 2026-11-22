// What the Split cell dialog accepts (ADR 0064): whole numbers of columns and rows, at least 2 cells in all, and at most
// SPLIT_LIMIT cells, the same rules the splitCell op applies.
import type { MessageKey } from '../../../../strings/t';
import { SPLIT_LIMIT } from './ops';

export type SplitReading =
  { ok: true; columns: number; rows: number } | { ok: false; error: MessageKey; field: 'columns' | 'rows' | 'both' };

const WHOLE = /^\s*\d{1,3}\s*$/;

/** The columns and rows the person typed, or the error to show. */
export function readSplit(columns: string, rows: string): SplitReading {
  if (!WHOLE.test(columns) || Number(columns) < 1)
    return { ok: false, error: 'sheetMerge.split.errorColumns', field: 'columns' };
  if (!WHOLE.test(rows) || Number(rows) < 1) return { ok: false, error: 'sheetMerge.split.errorRows', field: 'rows' };
  const c = Number(columns);
  const r = Number(rows);
  if (c * r < 2) return { ok: false, error: 'sheetMerge.split.errorSame', field: 'both' };
  if (c * r > SPLIT_LIMIT) return { ok: false, error: 'sheetMerge.split.errorMany', field: 'both' };
  return { ok: true, columns: c, rows: r };
}
