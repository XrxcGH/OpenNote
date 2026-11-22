// Formula translation for the clipboard (ADR 0067). A pasted formula keeps pointing at the same cells relative to
// itself, as in a spreadsheet. The clipboard carries formulas in R1C1 form: R[-2]C[0] is two rows up in the same
// column, and R3C1 (no brackets) is the absolute cell in sheet row 3, column 1.
//
// Rows count differently in a table with a header row. OpenNote's A1 is the first row below the header (ADR 0058),
// while a spreadsheet's row 1 is the header itself. So absolute rows move by one when a header row exists:
// `absRows` is that offset. Relative references need no offset, since both sides count the same steps.
//
// Text in double quotes, sheet names in single quotes, OpenNote's [Column] names, and {id} references are never
// changed. A reference that would leave the sheet (above row 1 or left of column A) becomes #REF!.

import { columnFromLetters, lettersFromColumn } from '../../../../core/expr';

/** Strings and quoted sheet names, which never hold references. R1C1 brackets stay outside this pattern. */
const QUOTED = /("(?:[^"]|"")*"|'(?:[^']|'')*')/;
/** Strings, quoted sheet names, [Column] names, and {id} references, for A1 text. */
const SKIP_A1 = /("(?:[^"]|"")*"|'(?:[^']|'')*'|\[[^\]]*\]|\{[^}]*\})/;
/** An A1 cell such as B2 or $B$2. A name followed by "(" is a function (LOG10), so it is left alone. */
const A1 = /(?<![A-Za-z0-9_.$])(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(])/g;
/** An R1C1 cell such as R[-1]C[0], RC[2], R3C1, or RC. Whole rows (R[1]) and whole columns (C[1]) are left alone. */
const RC = /(?<![A-Za-z0-9_.$])R(?:\[([+-]?\d+)\]|(\d+))?C(?:\[([+-]?\d+)\]|(\d+))?(?![A-Za-z0-9_([])/gi;
/** The prefixes Excel writes before newer function names in files and on the clipboard. */
const PREFIX = /_xl(?:fn|ws|udf)\./gi;

export interface At {
  /** Zero-based row of the cell that holds the formula, in the frame its relative references count from. */
  row: number;
  col: number;
}

/** Runs `edit` on the parts of a formula outside the parts `skip` matches. */
function outside(formula: string, skip: RegExp, edit: (part: string) => string): string {
  return formula
    .split(skip)
    .map((part, i) => (i % 2 === 1 ? part : edit(part)))
    .join('');
}

/**
 * A1 text to R1C1 text. `at` is the cell's own position; `absRows` is added to absolute row numbers (the header
 * row offset when writing a table's formula for a spreadsheet, 0 for a spreadsheet's own formula).
 */
export function a1ToR1C1(formula: string, at: At, absRows = 0): string {
  return outside(formula.replace(PREFIX, ''), SKIP_A1, (part) =>
    part.replace(A1, (whole, pinCol: string, letters: string, pinRow: string, digits: string) => {
      const col = columnFromLetters(letters);
      const row = Number(digits) - 1;
      if (col < 0 || row < 0) return whole;
      const r = pinRow ? `R${row + 1 + absRows}` : `R[${row - at.row}]`;
      const c = pinCol ? `C${col + 1}` : `C[${col - at.col}]`;
      return r + c;
    }),
  );
}

/**
 * R1C1 text to A1 text for the cell at `at`. `absRows` is taken off absolute row numbers (the header row offset when
 * pasting into a table with a header row). A reference above the first row or left of column A becomes #REF!.
 */
export function r1c1ToA1(formula: string, at: At, absRows = 0): string {
  return outside(formula.replace(PREFIX, ''), QUOTED, (part) =>
    part.replace(RC, (_whole, rowStep?: string, rowAbs?: string, colStep?: string, colAbs?: string) => {
      const row = rowAbs !== undefined ? Number(rowAbs) - 1 - absRows : at.row + Number(rowStep ?? 0);
      const col = colAbs !== undefined ? Number(colAbs) - 1 : at.col + Number(colStep ?? 0);
      if (row < 0 || col < 0) return '#REF!';
      return `${colAbs !== undefined ? '$' : ''}${lettersFromColumn(col)}${rowAbs !== undefined ? '$' : ''}${row + 1}`;
    }),
  );
}

/** Whether text is a formula: it starts with "=" and has something after it. */
export function isFormula(text: string): boolean {
  return text.startsWith('=') && text.trim().length > 1;
}
