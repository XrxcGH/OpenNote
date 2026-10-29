// Where each element sits in the periodic table grid, and which element an arrow key moves to. The main table is
// rows 1 to 7 and columns 1 to 18. The f-block (lanthanum to ytterbium and actinium to nobelium; lutetium and
// lawrencium are in group 3) sits in two rows
// below it, starting under column 3, as printed tables show it.
import type { Element } from './data';

export interface Cell {
  row: number;
  col: number;
}

export const GRID_COLUMNS = 18;
export const GRID_ROWS = 10;

/** The cell of an element: its period and group, or a row of the f-block below the table. */
export function cellOf(element: Pick<Element, 'number' | 'period' | 'groupNumber'>): Cell {
  if (element.groupNumber !== null) return { row: element.period, col: element.groupNumber };
  const first = element.period === 6 ? 57 : 89;
  return { row: element.period === 6 ? 9 : 10, col: 3 + element.number - first };
}

export type NavKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';

/**
 * The element an arrow key moves to from `from`, among the `shown` ones, or `from` if there is nowhere to go. Left and
 * right move along the row past gaps. Up and down move to the nearest row that has an element, and in it to the element
 * nearest the same column. Home and End go to the first and last element of the row.
 */
export function neighborOf(shown: readonly Element[], from: Element, key: NavKey): Element {
  const here = cellOf(from);
  const cells = shown.map((element) => ({ element, ...cellOf(element) }));
  const inRow = (row: number) => cells.filter((one) => one.row === row).sort((a, b) => a.col - b.col);
  if (key === 'ArrowLeft') return [...inRow(here.row)].reverse().find((one) => one.col < here.col)?.element ?? from;
  if (key === 'ArrowRight') return inRow(here.row).find((one) => one.col > here.col)?.element ?? from;
  if (key === 'Home') return inRow(here.row)[0]?.element ?? from;
  if (key === 'End') return inRow(here.row).at(-1)?.element ?? from;
  const step = key === 'ArrowUp' ? -1 : 1;
  for (let row = here.row + step; row >= 1 && row <= GRID_ROWS; row += step) {
    const candidates = inRow(row);
    if (candidates.length === 0) continue;
    return candidates.reduce((best, one) => (Math.abs(one.col - here.col) < Math.abs(best.col - here.col) ? one : best))
      .element;
  }
  return from;
}
