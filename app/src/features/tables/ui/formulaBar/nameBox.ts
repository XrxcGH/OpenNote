// The name box: what it shows for the selection (a cell, a range, or the name defined for exactly that range), and
// what typing in it selects. Grid cells count the header row, as the editor's table does; addresses count data rows,
// as formulas do.
import { gridRange, refCells } from './refs';
import { lettersOf, scanFormula } from './scan';

export interface GridBox {
  readonly top: number;
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
}

export interface BoxName {
  readonly name: string;
  readonly ref: string;
}

/** The range a name's formula is, in its own table, or null when it is a value, a formula, or another table's. */
export function nameBoxOf(ref: string, header: boolean): GridBox | null {
  const tokens = scanFormula(`=${ref.trim()}`).filter((t) => t.kind !== 'space');
  if (tokens.length !== 2 || tokens[1]!.kind !== 'ref') return null;
  return refCells(tokens[1]!, header);
}

const sameBox = (a: GridBox, b: GridBox) =>
  a.top === b.top && a.left === b.left && a.bottom === b.bottom && a.right === b.right;

/** What the name box shows for a selection: a defined name for exactly that range, or its address. */
export function nameBoxText(box: GridBox, header: boolean, names: readonly BoxName[] = []): string {
  const named = names.find((n) => {
    const own = nameBoxOf(n.ref, header);
    return own !== null && sameBox(own, box);
  });
  if (named) return named.name;
  const text = gridRange({ row: box.top, column: box.left }, { row: box.bottom, column: box.right }, header);
  // The header row has no address of its own: it shows the column, as "B" for the header of column B.
  return text ?? lettersOf(box.left);
}

/**
 * What typing in the name box selects: a cell ("C3"), a range ("A1:B4"), or a name whose formula is a range of this
 * table. Null when the text is none of those or lies outside the table of `rows` by `columns` grid cells.
 */
export function readNameBox(
  text: string,
  header: boolean,
  size: { rows: number; columns: number },
  names: readonly BoxName[] = [],
): GridBox | null {
  const typed = text.trim();
  if (!typed) return null;
  const named = names.find((n) => n.name.toLowerCase() === typed.toLowerCase());
  const box = nameBoxOf(named ? named.ref : typed, header);
  if (!box) return null;
  if (box.bottom >= size.rows || box.right >= size.columns) return null;
  return box;
}
