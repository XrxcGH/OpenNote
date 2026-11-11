// Overflow, center across, rotation, and shrink to fit: the layout rules that need neighbors or measures. The
// functions are pure; the measuring pass (measure.ts) feeds them sizes.

import { growsLeft, type ValueKind } from './align';
import type { Align } from '../model';

export interface RowCell {
  text: string;
  kind: ValueKind;
  align: Align;
  /** A merge anchor or a cell a merge covers never takes part in overflow. */
  merged?: boolean;
}

/**
 * How many empty cells a cell's text may draw across, on each side. Only text with wrap `overflow` spills, numbers
 * never do, and the text stops at the first neighbor that has content. Centered text spills both ways, but only as
 * far as the nearer side allows, so it stays centered.
 */
export function overflowCells(row: readonly RowCell[], at: number): { before: number; after: number } {
  const none = { before: 0, after: 0 };
  const cell = row[at];
  if (!cell || cell.text.trim() === '' || cell.merged) return none;
  if (cell.align.wrap !== 'overflow' || cell.kind === 'number' || cell.kind === 'date') return none;
  const free = (step: number): number => {
    let n = 0;
    for (let i = at + step; i >= 0 && i < row.length; i += step) {
      if (row[i].text.trim() !== '' || row[i].merged) break;
      n += 1;
    }
    return n;
  };
  const h = cell.align.h;
  if (h === 'center') {
    const n = Math.min(free(-1), free(1));
    return { before: n, after: n };
  }
  if (growsLeft(h, cell.kind, cell.align.dir === 'rtl')) return { before: free(-1), after: 0 };
  return { before: 0, after: free(1) };
}

/** Center across selection: how many empty cells after a centered one share its centering. */
export function centerAcrossSpan(row: readonly RowCell[], at: number): number {
  const cell = row[at];
  if (!cell || cell.align.h !== 'centerAcross' || cell.text.trim() === '') return 0;
  let n = 0;
  for (let i = at + 1; i < row.length; i += 1) {
    const next = row[i];
    if (next.text.trim() !== '' || next.align.h !== 'centerAcross') break;
    n += 1;
  }
  return n;
}

/** The bounding box of a w by h box turned by `degrees`. A row grows to this height, as in Excel. */
export function rotatedBox(width: number, height: number, degrees: number): { width: number; height: number } {
  const r = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(r));
  const sin = Math.abs(Math.sin(r));
  return { width: width * cos + height * sin, height: width * sin + height * cos };
}

/** The font scale that makes text of `textWidth` fit `boxWidth`: 1 when it fits, never below 0.25. */
export function shrinkScale(textWidth: number, boxWidth: number): number {
  if (textWidth <= 0 || boxWidth <= 0 || textWidth <= boxWidth) return 1;
  return Math.max(0.25, Math.floor((boxWidth / textWidth) * 100) / 100);
}
