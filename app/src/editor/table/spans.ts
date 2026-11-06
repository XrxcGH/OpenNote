// Which merged cells a table may keep (ADR 0064). The table normalizer (tableKit.ts) asks this
// file, and splits every other merged cell. This is a stub: it allows no spans, so every table stays a plain
// grid, as before. The merge lane owns this file from its first merge on and fills it in from data.sheet.merges.
import type { Node as PMNode } from '@tiptap/pm/model';

/** A merged cell, by its top-left position in the grid and its size. Positions count from 0. */
export interface CellSpan {
  row: number;
  column: number;
  rows: number;
  columns: number;
}

/** The merged cells `table` may keep. A span not listed here is split into single cells. */
export function allowedSpans(_table: PMNode): readonly CellSpan[] {
  return [];
}
