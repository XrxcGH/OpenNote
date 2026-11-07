// Spreadsheet references: A1, $B$3, A1:B5, whole columns such as C:C, and whole rows such as 3:3. Columns count
// from 0 (A is 0) and rows count from 0 (row 1 is 0), so the tree matches how a table stores its data. Each reader
// also says which parts carried a "$".

const CELL = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/;
const COLUMN = /^(\$?)([A-Za-z]{1,3})$/;
const ROW = /^(\$?)(\d+)$/;
/** R1C1 notation: R2C3, R[-1]C, RC[2], R[1]C[-1]. */
const R1C1 = /^R(?:\[([+-]?\d+)\]|(\d+))?C(?:\[([+-]?\d+)\]|(\d+))?$/i;

/** The zero-based column for letters such as "A", "Z", "AA", or -1 when they are not one to three letters. */
export function columnFromLetters(letters: string): number {
  if (!/^[A-Za-z]{1,3}$/.test(letters)) return -1;
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** The letters for a zero-based column: 0 is "A", 25 is "Z", 26 is "AA". */
export function lettersFromColumn(column: number): string {
  let n = column + 1;
  let letters = '';
  while (n > 0) {
    const rest = (n - 1) % 26;
    letters = String.fromCharCode(65 + rest) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

export interface CellRef {
  col: number;
  /** Zero-based. -1 when the text said row 0, which is not a row. */
  row: number;
  /** Whether the column and the row were written with "$". */
  colAbs: boolean;
  rowAbs: boolean;
}

/** Reads text such as "A1" or "$B$3". Returns null when it is not a cell. */
export function readCell(text: string): { col: number; row: number } | null {
  const ref = readCellRef(text);
  return ref === null ? null : { col: ref.col, row: ref.row };
}

/** Reads text such as "A1" or "$B$3" with its "$" flags. Returns null when it is not a cell. */
export function readCellRef(text: string): CellRef | null {
  const match = CELL.exec(text);
  if (!match) return null;
  return {
    col: columnFromLetters(match[2]),
    row: Number(match[4]) - 1,
    colAbs: match[1] === '$',
    rowAbs: match[3] === '$',
  };
}

/** Reads text such as "B" or "$B" as a column. Returns its zero-based index, or -1. */
export function readColumn(text: string): number {
  const match = COLUMN.exec(text);
  return match ? columnFromLetters(match[2]) : -1;
}

/** Whether a column or row reference such as "$B" or "$3" was written with "$". */
export function isAbsolute(text: string): boolean {
  return text.startsWith('$');
}

/** Reads text such as "3" or "$3" as a whole row. Returns its zero-based index, or -1. */
export function readRow(text: string): number {
  const match = ROW.exec(text);
  return match && Number(match[2]) > 0 ? Number(match[2]) - 1 : -1;
}

/**
 * Reads an R1C1 reference relative to the cell at `anchor` (zero-based): R2C3 is C2, and R[-1]C is the cell above
 * the anchor. A number without brackets is absolute, so it carries "$". Returns null when the text is not one.
 */
export function readR1C1(text: string, anchor: { row: number; col: number }): CellRef | null {
  const match = R1C1.exec(text);
  if (!match) return null;
  const [, rowOffset, rowAbs, colOffset, colAbs] = match;
  return {
    row: rowAbs !== undefined ? Number(rowAbs) - 1 : anchor.row + Number(rowOffset ?? 0),
    col: colAbs !== undefined ? Number(colAbs) - 1 : anchor.col + Number(colOffset ?? 0),
    rowAbs: rowAbs !== undefined,
    colAbs: colAbs !== undefined,
  };
}
