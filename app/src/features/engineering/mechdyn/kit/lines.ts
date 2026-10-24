// Tables typed one row per line, such as gear meshes or a Denavit-Hartenberg table: numbers split by spaces, commas,
// or semicolons, each read with the expression engine so "pi/2" works. A row that can't be read names its line.
import { evaluate } from '../../../../core/expr';
import { fail } from './errors';

export interface Row {
  readonly numbers: number[];
  /** Words on the line that aren't numbers, in lower case, such as "internal". */
  readonly words: string[];
}

/** The rows of a typed table, each with `count` numbers (or between `count` and `most`). */
export function readRows(text: string, count: number, most = count): Row[] {
  const rows: Row[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const cells = line
      .split(/[\s,;]+/)
      .map((cell) => cell.trim())
      .filter(Boolean);
    if (cells.length === 0) return;
    const numbers: number[] = [];
    const words: string[] = [];
    for (const cell of cells) {
      const value = evaluate(cell);
      if (value.ok && Number.isFinite(value.value)) numbers.push(value.value);
      else if (/^[a-z]+$/i.test(cell)) words.push(cell.toLowerCase());
      else fail('listRow', { line: String(index + 1), count: String(count) });
    }
    if (numbers.length < count || numbers.length > most)
      fail('listRow', { line: String(index + 1), count: String(count) });
    rows.push({ numbers, words });
  });
  if (rows.length === 0) fail('listEmpty');
  return rows;
}

/** A list of numbers typed on one line, such as joint angles. */
export function readList(text: string): number[] {
  const cells = text
    .split(/[\s,;]+/)
    .map((cell) => cell.trim())
    .filter(Boolean);
  return cells.map((cell) => {
    const value = evaluate(cell);
    if (!value.ok || !Number.isFinite(value.value)) return fail('fieldUnreadable', { text: cell });
    return value.value;
  });
}
