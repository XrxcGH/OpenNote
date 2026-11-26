// What the fill handle writes (DESIGN.md sections 12 and 13.6), as a pure function of the cells' text. The handle
// extends a box along one axis. Each line of the box (a column when filling down or up, a row when filling right
// or left) is continued on its own. A line with a formula copies its cells, with the references moved.
import { continueSeries } from '../engine/series';
import type { SeriesOptions } from '../engine/series';
import type { Box, GridCell, Texts } from '../keys/grid';
import { filledText } from '../smart/fill';

/** How a drop fills: the series rules, plain copies, or (for the menu after the drop) only the formats. */
export type FillMode = 'series' | 'copy' | 'formats' | 'values';

export type Direction = 'down' | 'up' | 'right' | 'left';

export interface FillWrite {
  /** The cell that is written. */
  at: GridCell;
  /** The source cell its format comes from. */
  from: GridCell;
  /** The new text, or null when only the format is written. */
  text: string | null;
}

/** The axis and the new box when a drag from `source` reaches `over`; null when it stays inside. */
export function targetOf(source: Box, over: GridCell): { box: Box; direction: Direction } | null {
  const below = over.row - source.bottom;
  const above = source.top - over.row;
  const right = over.column - source.right;
  const left = source.left - over.column;
  const farthest = Math.max(below, above, right, left);
  if (farthest <= 0) return null;
  if (farthest === below) return { box: { ...source, bottom: over.row }, direction: 'down' };
  if (farthest === above) return { box: { ...source, top: over.row }, direction: 'up' };
  if (farthest === right) return { box: { ...source, right: over.column }, direction: 'right' };
  return { box: { ...source, left: over.column }, direction: 'left' };
}

const isFormula = (text: string) => text.trim().startsWith('=');
const at = (texts: Texts, cell: GridCell) => texts[cell.row]?.[cell.column] ?? '';

/**
 * The writes that fill from `source` out to `box`. `mode` series continues numbers, dates, names, and counted text;
 * copy repeats the cells; formats writes only the formats (text null); values is the series without formats, which
 * the caller sees in `formats` of the result.
 */
export function planFill(
  texts: Texts,
  source: Box,
  box: Box,
  direction: Direction,
  mode: FillMode,
  options: SeriesOptions = {},
): { writes: FillWrite[]; formats: boolean } {
  const vertical = direction === 'down' || direction === 'up';
  const forward = direction === 'down' || direction === 'right';
  const lineCount = vertical ? source.right - source.left + 1 : source.bottom - source.top + 1;
  const length = vertical ? source.bottom - source.top + 1 : source.right - source.left + 1;
  const count = vertical ? box.bottom - box.top + 1 - length : box.right - box.left + 1 - length;
  const writes: FillWrite[] = [];
  if (count <= 0) return { writes, formats: mode !== 'values' };
  for (let line = 0; line < lineCount; line++) {
    // The cells of this line in the order of the fill: the cell nearest the new cells is last.
    const cells: GridCell[] = Array.from({ length: length }, (_, i) => {
      const k = forward ? i : length - 1 - i;
      return vertical
        ? { row: source.top + k, column: source.left + line }
        : { row: source.top + line, column: source.left + k };
    });
    const values = cells.map((cell) => at(texts, cell));
    const series =
      mode === 'series' || mode === 'values'
        ? !values.some(isFormula) && continueSeries(values, count, options)
        : false;
    for (let i = 0; i < count; i++) {
      const distance = i + 1;
      const target: GridCell = vertical
        ? { row: forward ? source.bottom + distance : source.top - distance, column: source.left + line }
        : { row: source.top + line, column: forward ? source.right + distance : source.left - distance };
      // A copy repeats the line, starting from its first cell in the direction of the fill.
      const from = cells[i % cells.length];
      let text: string | null;
      if (mode === 'formats') text = null;
      else if (series) text = series[i];
      else {
        const own = at(texts, from);
        text = isFormula(own) ? filledText(own.trim(), target.row - from.row, target.column - from.column) : own;
      }
      writes.push({ at: target, from, text });
    }
  }
  return { writes, formats: mode !== 'values' };
}
