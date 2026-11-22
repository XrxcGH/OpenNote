// Which merged cells a table may keep (ADR 0064). The table normalizer (tableKit.ts) asks this file, and splits
// every other merged cell. The declaration lives on the table node as the `merges` attribute: the spans that
// `data.sheet.merges` makes in the table's current order, which `tableDataToDoc` writes from the block's data.
// Pasted HTML carries no declaration, so a pasted span is split, as before.
import type { Node as PMNode } from '@tiptap/pm/model';

/** A merged cell, by its top-left position in the grid and its size. Positions count from 0. */
export interface CellSpan {
  row: number;
  column: number;
  rows: number;
  columns: number;
}

/** The most merges a table keeps (ADR 0064 limits), so a hostile file cannot make a grid of thousands of spans. */
const SPAN_LIMIT = 10_000;

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1;
const isIndex = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

/** A span read from untrusted JSON, or null when it is not one. */
function readSpan(value: unknown): CellSpan | null {
  if (typeof value !== 'object' || value === null) return null;
  const { row, column, rows, columns } = value as Record<string, unknown>;
  if (!isIndex(row) || !isIndex(column) || !isCount(rows) || !isCount(columns)) return null;
  return rows * columns > 1 ? { row, column, rows, columns } : null;
}

/** The merged cells `table` may keep. A span not listed here is split into single cells. */
export function allowedSpans(table: PMNode): readonly CellSpan[] {
  const declared = table.attrs.merges as unknown;
  if (!Array.isArray(declared)) return [];
  const spans: CellSpan[] = [];
  for (const one of declared.slice(0, SPAN_LIMIT)) {
    const span = readSpan(one);
    if (span) spans.push(span);
  }
  return spans;
}

/** The table's rows and columns by ID, which is all the merges need of it. */
interface Lines {
  columns: readonly { id: string }[];
  rows: readonly { id: string }[];
}

const idsOf = (value: unknown): [string, string] | null =>
  Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'string'
    ? [value[0], value[1]]
    : null;

/** Merge IDs in code point order, as the sheet model sorts them, so the lower ID wins an overlap. */
const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The spans of `sheet.merges` (the block's `data.sheet`, untrusted JSON) over the table's rows and columns. A merge
 * of one cell, one whose corner is gone, and one that overlaps a merge with a lower ID are left out, as the sheet
 * model reads them. Positions follow the current order of the rows and columns.
 */
export function spansOf(table: Lines, sheet: unknown): CellSpan[] {
  const merges = typeof sheet === 'object' && sheet !== null ? (sheet as Record<string, unknown>).merges : null;
  if (typeof merges !== 'object' || merges === null || Array.isArray(merges)) return [];
  const rowAt = new Map<string, number>();
  table.rows.forEach((row, i) => rowAt.set(row.id, i));
  const colAt = new Map<string, number>();
  table.columns.forEach((column, i) => colAt.set(column.id, i));
  const taken = new Set<number>();
  const width = table.columns.length;
  const out: CellSpan[] = [];
  const record = merges as Record<string, unknown>;
  for (const id of Object.keys(record).sort(byId)) {
    const entry = record[id];
    if (typeof entry !== 'object' || entry === null) continue;
    const from = idsOf((entry as Record<string, unknown>).from);
    const to = idsOf((entry as Record<string, unknown>).to);
    if (!from || !to) continue;
    const r1 = rowAt.get(from[0]);
    const r2 = rowAt.get(to[0]);
    const c1 = colAt.get(from[1]);
    const c2 = colAt.get(to[1]);
    if (r1 === undefined || r2 === undefined || c1 === undefined || c2 === undefined) continue;
    const span: CellSpan = {
      row: Math.min(r1, r2),
      column: Math.min(c1, c2),
      rows: Math.abs(r1 - r2) + 1,
      columns: Math.abs(c1 - c2) + 1,
    };
    if (span.rows * span.columns < 2) continue;
    let free = true;
    for (let r = span.row; free && r < span.row + span.rows; r++)
      for (let c = span.column; c < span.column + span.columns; c++) if (taken.has(r * width + c)) free = false;
    if (!free) continue;
    for (let r = span.row; r < span.row + span.rows; r++)
      for (let c = span.column; c < span.column + span.columns; c++) taken.add(r * width + c);
    out.push(span);
    if (out.length >= SPAN_LIMIT) break;
  }
  return out;
}
