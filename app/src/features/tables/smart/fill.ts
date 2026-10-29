// Fill down and fill right (Phase 7). A formula copied to another cell keeps pointing at the same places relative
// to itself, like a spreadsheet: "=B2*C2" filled one row down becomes "=B3*C3". A "$" in front of a column letter
// or a row number pins it. Text in quotes, [Column] names, and {id} references are never shifted.
import { columnFromLetters, lettersFromColumn } from '../../../core/expr';

const SKIP = /("(?:[^"]|"")*"|\[[^\]]*\]|\{[^}]*\})/;
const REF = /(?<![A-Za-z0-9_.$])(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(])/g;

/** The formula moved `rows` down and `columns` right, or null when a reference would leave the table. */
export function shiftFormula(formula: string, rows: number, columns: number): string | null {
  let off = false;
  const shifted = formula
    .split(SKIP)
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part.replace(REF, (whole, pinColumn: string, letters: string, pinRow: string, row: string) => {
        const column = columnFromLetters(letters);
        if (column < 0) return whole;
        const nextColumn = pinColumn ? column : column + columns;
        const nextRow = pinRow ? Number(row) : Number(row) + rows;
        if (nextColumn < 0 || nextRow < 1) {
          off = true;
          return whole;
        }
        return `${pinColumn}${lettersFromColumn(nextColumn)}${pinRow}${nextRow}`;
      });
    })
    .join('');
  return off ? null : shifted;
}

/** What a cell becomes when filled from a source `rows` and `columns` away. Text that is not a formula is copied. */
export function filledText(source: string, rows: number, columns: number): string {
  if (!source.startsWith('=')) return source;
  return '=' + (shiftFormula(source.slice(1), rows, columns) ?? source.slice(1));
}
