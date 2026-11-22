// SQL result sets (DESIGN 9.1): the query's rows as CSV text, compared with the expected CSV. The first line is the
// column names and must match. Rows match in order when the case says so, and as a multiset otherwise. In `number`
// mode a cell that is a number in both has the tolerance.
import { TEST_DEFAULTS } from '../contracts';
import type { CompareSpec } from '../contracts';
import { asNumber, closeEnough } from './compare';
import type { Comparison } from './compare';

/** CSV text as rows of cells (RFC 4180: quotes, doubled quotes, line breaks inside quotes). Blank lines are skipped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const endRow = () => {
    row.push(cell);
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
    cell = '';
  };
  for (let at = 0; at < text.length; at++) {
    const c = text[at]!;
    if (quoted) {
      if (c !== '"') cell += c;
      else if (text[at + 1] === '"') {
        cell += '"';
        at++;
      } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[at + 1] === '\n') at++;
      endRow();
    } else cell += c;
  }
  if (cell !== '' || row.length > 0) endRow();
  return rows;
}

function sameCell(a: string, e: string, spec: CompareSpec): boolean {
  if (a === e) return true;
  if (spec.mode !== 'number') return false;
  const x = asNumber(a);
  const y = asNumber(e);
  return x !== null && y !== null && closeEnough(x, y, spec.tolerance ?? TEST_DEFAULTS.tolerance, spec.relative);
}

const sameRow = (a: string[], e: string[], spec: CompareSpec) =>
  a.length === e.length && a.every((cell, at) => sameCell(cell, e[at]!, spec));

/** Compares two result sets given as CSV. `line` of a failure is the row (the header is row 1). */
export function compareResultSets(actual: string, expected: string, ordered: boolean, spec: CompareSpec): Comparison {
  const [headA = [], ...rowsA] = parseCsv(actual);
  const [headE = [], ...rowsE] = parseCsv(expected);
  if (headA.length !== headE.length || headA.some((name, at) => name.trim() !== headE[at]!.trim()))
    return { pass: false, reason: 'different', line: 1 };
  if (rowsA.length !== rowsE.length)
    return { pass: false, reason: 'count', line: Math.min(rowsA.length, rowsE.length) + 2 };
  if (ordered) {
    const bad = rowsA.findIndex((row, at) => !sameRow(row, rowsE[at]!, spec));
    return bad < 0 ? { pass: true } : { pass: false, reason: 'different', line: bad + 2 };
  }
  const left = [...rowsE];
  for (const row of rowsA) {
    const at = left.findIndex((other) => sameRow(row, other, spec));
    if (at < 0) return { pass: false, reason: 'different' };
    left.splice(at, 1);
  }
  return { pass: true };
}
