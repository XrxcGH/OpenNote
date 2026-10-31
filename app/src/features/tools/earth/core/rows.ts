// Pasted tables for the earth kit: one row per line, cells split by commas, tabs, semicolons, or spaces, so a
// column copied from a spreadsheet or a CSV file reads the same. Blank lines and lines starting with # are skipped,
// and a first line of words is taken as a header.
import { readNumber } from './format';
import { Problem } from './problem';

export interface Row {
  /** The line number in the pasted text, counting from 1. */
  line: number;
  cells: string[];
}

const SPLIT = /\s*[,;\t]\s*|\s+/;

export function splitRows(text: string): Row[] {
  return text
    .split(/\r?\n/)
    .map((raw, i) => ({ line: i + 1, cells: raw.trim() === '' ? [] : raw.trim().split(SPLIT) }))
    .filter((row) => row.cells.length > 0 && !row.cells[0].startsWith('#'));
}

/** Rows of numbers with at least `min` columns; a first row of words is a header and is skipped. */
export function numberRows(text: string, min: number, max = min): number[][] {
  const rows = splitRows(text);
  const isNumber = (cell: string) => !Number.isNaN(readNumber(cell) ?? Number.NaN);
  if (rows.length > 0 && !rows[0].cells.some(isNumber)) rows.shift();
  return rows.map((row) => {
    if (row.cells.length < min) throw new Problem('rowShort', { line: row.line, count: min });
    return row.cells.slice(0, max).map((cell) => {
      const value = readNumber(cell);
      if (value === null || Number.isNaN(value)) throw new Problem('rowNumber', { line: row.line, cell });
      return value;
    });
  });
}
