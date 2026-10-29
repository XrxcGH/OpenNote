// Spreadsheet references: A1, $B$3, A1:B5, and whole columns such as C:C. Columns count from 0 (A is 0) and rows
// count from 0 (row 1 is 0), so the tree matches how a table stores its data.

const CELL = /^\$?([A-Za-z]{1,3})\$?(\d+)$/;
const COLUMN = /^\$?([A-Za-z]{1,3})$/;

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
}

/** Reads text such as "A1" or "$B$3". Returns null when it is not a cell. */
export function readCell(text: string): CellRef | null {
  const match = CELL.exec(text);
  return match ? { col: columnFromLetters(match[1]), row: Number(match[2]) - 1 } : null;
}

/** Reads text such as "B" or "$B" as a column. Returns its zero-based index, or -1. */
export function readColumn(text: string): number {
  const match = COLUMN.exec(text);
  return match ? columnFromLetters(match[1]) : -1;
}
