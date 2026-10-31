// Assignment problems by the Hungarian method. Reduce each row and column by its least entry. Cover the zeros with
// as few lines as possible (König's theorem, from a largest matching on the zeros). While fewer than n lines
// suffice, take the least uncovered entry from every uncovered cell and add it where two lines cross.
import { step } from '../core/step';
import type { Step } from '../core/step';
import { fail, num } from '../core/util';

export interface Cover {
  rows: boolean[];
  cols: boolean[];
  lines: number;
}

export interface AssignResult {
  /** Each row's column in the best assignment, over the square (padded) matrix. */
  match: number[];
  total: number;
  size: number;
  /** The reduced matrix after the row and column reductions and after the last adjustment. */
  reduced: number[][];
  steps: Step[];
}

const EPS = 1e-9;
const zero = (x: number) => Math.abs(x) <= EPS;

/** A largest matching of rows to columns over zero cells, by augmenting paths. */
function zeroMatching(m: number[][]): number[] {
  const n = m.length;
  const colOf: number[] = Array(n).fill(-1);
  const rowOfCol: number[] = Array(n).fill(-1);
  const tryRow = (i: number, seen: boolean[]): boolean => {
    for (let j = 0; j < n; j += 1) {
      if (!zero(m[i][j]) || seen[j]) continue;
      seen[j] = true;
      if (rowOfCol[j] < 0 || tryRow(rowOfCol[j], seen)) {
        rowOfCol[j] = i;
        colOf[i] = j;
        return true;
      }
    }
    return false;
  };
  for (let i = 0; i < n; i += 1) tryRow(i, Array<boolean>(n).fill(false));
  return colOf;
}

/** The fewest lines covering every zero: the rows not reached, and the columns reached, by alternating paths. */
function cover(m: number[][], colOf: number[]): Cover {
  const n = m.length;
  const rowOfCol: number[] = Array(n).fill(-1);
  colOf.forEach((j, i) => {
    if (j >= 0) rowOfCol[j] = i;
  });
  const rowSeen = Array<boolean>(n).fill(false);
  const colSeen = Array<boolean>(n).fill(false);
  const stack = colOf.flatMap((j, i) => (j < 0 ? [i] : []));
  for (const i of stack) rowSeen[i] = true;
  while (stack.length) {
    const i = stack.pop()!;
    for (let j = 0; j < n; j += 1)
      if (zero(m[i][j]) && !colSeen[j]) {
        colSeen[j] = true;
        const k = rowOfCol[j];
        if (k >= 0 && !rowSeen[k]) {
          rowSeen[k] = true;
          stack.push(k);
        }
      }
  }
  const rows = rowSeen.map((s) => !s);
  return { rows, cols: colSeen, lines: rows.filter(Boolean).length + colSeen.filter(Boolean).length };
}

export function hungarian(costIn: number[][], maximize = false): AssignResult {
  if (costIn.length === 0 || costIn[0].length === 0) fail('asEmpty');
  const n = Math.max(costIn.length, costIn[0].length);
  if (n > 12) fail('asTooBig', { size: 12 });
  const top = Math.max(...costIn.flat());
  const steps: Step[] = [];
  if (costIn.length !== costIn[0].length) steps.push(step('asPad', { size: n }));
  if (maximize) steps.push(step('asMax', { top: num(top) }));
  const m = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      const c = costIn[i]?.[j];
      if (c === undefined) return 0;
      return maximize ? top - c : c;
    }),
  );
  for (const r of m) {
    const low = Math.min(...r);
    r.forEach((_, j) => (r[j] -= low));
  }
  steps.push(step('asRows'));
  for (let j = 0; j < n; j += 1) {
    const low = Math.min(...m.map((r) => r[j]));
    for (const r of m) r[j] -= low;
  }
  steps.push(step('asCols'));
  let colOf = zeroMatching(m);
  for (let iter = 0; iter < n * n + 2; iter += 1) {
    const c = cover(m, colOf);
    if (c.lines >= n) {
      steps.push(step('asCovered', { lines: c.lines }));
      break;
    }
    let low = Infinity;
    for (let i = 0; i < n; i += 1)
      for (let j = 0; j < n; j += 1) if (!c.rows[i] && !c.cols[j]) low = Math.min(low, m[i][j]);
    for (let i = 0; i < n; i += 1)
      for (let j = 0; j < n; j += 1) {
        if (!c.rows[i] && !c.cols[j]) m[i][j] -= low;
        else if (c.rows[i] && c.cols[j]) m[i][j] += low;
      }
    steps.push(step('asAdjust', { lines: c.lines, size: n, least: num(low) }));
    colOf = zeroMatching(m);
  }
  const total = colOf.reduce((s, j, i) => s + (costIn[i]?.[j] ?? 0), 0);
  return { match: colOf, total, size: n, reduced: m, steps };
}
