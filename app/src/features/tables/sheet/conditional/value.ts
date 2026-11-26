// What a rule reads from a cell: a number, text, a boolean, an error, or nothing. A formula's value comes from the
// value cache when it is fresh (R-SHT-17); a typed cell is read from its text, as a spreadsheet reads it.

import { ERROR_TOKENS, textToNumber } from '../../engine/values';
import { readableText, valueAt } from '../model/cache';
import type { Sheet, TableLike } from '../model/types';

export type CellValue =
  | { kind: 'blank' }
  | { kind: 'num'; n: number }
  | { kind: 'text'; s: string }
  | { kind: 'bool'; b: boolean }
  | { kind: 'error'; e: string };

export const BLANK: CellValue = { kind: 'blank' };

const TOKENS: ReadonlySet<string> = new Set(Object.values(ERROR_TOKENS));
const MARKUP = /[*_~`[\]<\\&]/;

/** The value of typed text. Spaces only is blank; `TRUE` and `FALSE` are booleans; an error token is an error. */
export function readText(text: string): CellValue {
  const t = text.trim();
  if (t === '') return BLANK;
  const upper = t.toUpperCase();
  if (upper === 'TRUE' || upper === 'FALSE') return { kind: 'bool', b: upper === 'TRUE' };
  if (TOKENS.has(upper)) return { kind: 'error', e: upper };
  const n = textToNumber(t);
  return n === null ? { kind: 'text', s: t } : { kind: 'num', n };
}

/** The value a cached result stands for. */
function readCached(cached: unknown): CellValue {
  if (cached === null || cached === undefined) return BLANK;
  if (typeof cached === 'number') return { kind: 'num', n: cached };
  if (typeof cached === 'boolean') return { kind: 'bool', b: cached };
  if (typeof cached === 'string') return cached === '' ? BLANK : { kind: 'text', s: cached };
  const e = (cached as { e?: unknown }).e;
  return { kind: 'error', e: typeof e === 'string' ? e : '#VALUE!' };
}

/** The value of the cell at a row and column position. A position outside the table is blank. */
export function valueOfCell(sheet: Sheet, table: TableLike, row: number, col: number): CellValue {
  const r = table.rows[row];
  const c = table.columns[col];
  if (!r || !c) return BLANK;
  const markdown = Object.hasOwn(r.cells, c.id) ? r.cells[c.id].markdown : '';
  if (markdown.startsWith('=') || markdown === '') {
    const cached = valueAt(sheet, table, r.id, c.id);
    if (cached !== undefined && cached !== null) return readCached(cached);
    // A stale cache or a formula that was never calculated reads as text, which is what the cell shows.
  }
  return readText(MARKUP.test(markdown) ? readableText(markdown) : markdown);
}

/** The number a cell holds, or undefined for any other value. */
export function numberOf(value: CellValue): number | undefined {
  return value.kind === 'num' ? value.n : undefined;
}

/** The text a cell shows, for text rules and for finding duplicates. */
export function textOf(value: CellValue): string {
  switch (value.kind) {
    case 'blank':
      return '';
    case 'num':
      return String(value.n);
    case 'text':
      return value.s;
    case 'bool':
      return value.b ? 'TRUE' : 'FALSE';
    default:
      return value.e;
  }
}
