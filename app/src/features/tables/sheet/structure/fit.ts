// Auto-fit and distribute (DESIGN 13.2). The width of a column is its widest cell's text plus the cell's padding.
// The text is measured by a function the caller gives (the browser measures with a canvas; a test gives a fixed
// width per character), so the rule is the same everywhere and a test does not need a layout engine.

import { clampColumnWidth } from '../../../../editor/table/mapping';
import { own, ownObject } from '../model/json';
import type { Sheet } from '../model/types';

/** A point is 96/72 of a page unit (a page unit is a CSS pixel). */
const PX_PER_PT = 96 / 72;
/** The left and right border of a cell, in page units. */
const BORDER = 1;

/** The space a cell adds around its text: the table's padding (4 pt each side by default) and its borders. */
export function columnPadding(sheet: Sheet): number {
  const pad = ownObject(ownObject(sheet, 'table'), 'pad');
  const side = (key: string) => {
    const v = own(pad, key);
    return typeof v === 'number' && v >= 0 ? v : 4;
  };
  return Math.round((side('l') + side('r')) * PX_PER_PT * 100) / 100 + BORDER;
}

/** The width that fits a column whose widest text measures `content`. */
export function fitWidth(content: number, padding: number): number {
  return clampColumnWidth(Math.ceil(content + padding));
}

/** The widest line of a text, by `measure`. */
export function widest(text: string, measure: (line: string) => number): number {
  let most = 0;
  for (const line of text.split(/\r?\n|<br\s*\/?>/i)) most = Math.max(most, measure(line));
  return most;
}

/** A column and the text its cells show. `texts` is the text of each row in the column. */
export interface FitColumn {
  index: number;
  texts: readonly string[];
}

/** Widths for the columns, by column index: the widest text of each plus the padding. A column with no text keeps `null`. */
export function fitColumnWidths(
  columns: readonly FitColumn[],
  measure: (line: string) => number,
  padding: number,
): Map<number, number | null> {
  const out = new Map<number, number | null>();
  for (const column of columns) {
    let most = 0;
    for (const text of column.texts) most = Math.max(most, widest(text, measure));
    out.set(column.index, most > 0 ? fitWidth(most, padding) : null);
  }
  return out;
}

/** Equal widths that keep the total of the columns (Distribute columns). */
export function distributedWidths(widths: readonly number[]): number[] {
  if (widths.length === 0) return [];
  const total = widths.reduce((sum, w) => sum + w, 0);
  const each = clampColumnWidth(total / widths.length);
  return widths.map(() => each);
}

/** A text measurer for the browser: `font` is a CSS font shorthand such as `16px Inter`. Without a canvas, it estimates. */
export function canvasMeasure(font: string, fallbackSize = 16): (line: string) => number {
  let context: { font: string; measureText(text: string): { width: number } } | null = null;
  try {
    if (typeof document !== 'undefined') context = document.createElement('canvas').getContext('2d');
  } catch {
    context = null;
  }
  if (!context) return (line) => line.length * fallbackSize * 0.55;
  context.font = font;
  const ctx = context;
  return (line) => ctx.measureText(line).width;
}
