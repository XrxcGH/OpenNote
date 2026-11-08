// What the rules that look across a range need: the numbers in it (sorted), their average and spread, and how often
// each text occurs. Worked out once per rule and table object, as the model reads rules (rules.ts).

import type { Rule } from '../model/rules';
import type { Sheet, TableLike } from '../model/types';
import { textOf, valueOfCell, type CellValue } from './value';

export interface Stats {
  /** The numbers in the rule's ranges, from least to greatest. */
  numbers: number[];
  min: number;
  max: number;
  average: number;
  /** The sample standard deviation (STDEV.S); 0 for fewer than two numbers. */
  deviation: number;
  /** How many times each value occurs, by lowercase text, for duplicate and unique. */
  counts: Map<string, number>;
}

/** True for the header row, which no rule formats or counts. */
export function isHeaderRow(table: TableLike, row: number): boolean {
  return table.header === true && row === 0;
}

/** Calls `visit` for each cell of the rule's ranges once, never for the header row. */
export function eachCell(rule: Rule, table: TableLike, visit: (row: number, col: number) => void): void {
  const seen = new Set<number>();
  const cols = table.columns.length;
  for (const box of rule.boxes) {
    for (
      let r = Math.max(box.top, table.header === true ? 1 : 0);
      r <= Math.min(box.bottom, table.rows.length - 1);
      r++
    )
      for (let c = box.left; c <= Math.min(box.right, cols - 1); c++) {
        const key = r * cols + c;
        if (seen.has(key)) continue;
        seen.add(key);
        visit(r, c);
      }
  }
}

const kept = new WeakMap<object, WeakMap<TableLike, Stats>>();

/** The statistics of a rule's range. */
export function statsOf(sheet: Sheet, table: TableLike, rule: Rule): Stats {
  const byTable = kept.get(rule.rule) ?? new WeakMap<TableLike, Stats>();
  kept.set(rule.rule, byTable);
  const known = byTable.get(table);
  if (known) return known;
  const numbers: number[] = [];
  const counts = new Map<string, number>();
  eachCell(rule, table, (r, c) => {
    const v: CellValue = valueOfCell(sheet, table, r, c);
    if (v.kind === 'num') numbers.push(v.n);
    if (v.kind !== 'blank') {
      const key = textOf(v).toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  });
  numbers.sort((a, b) => a - b);
  const n = numbers.length;
  const sum = numbers.reduce((a, b) => a + b, 0);
  const average = n === 0 ? 0 : sum / n;
  const deviation = n < 2 ? 0 : Math.sqrt(numbers.reduce((a, b) => a + (b - average) ** 2, 0) / (n - 1));
  const stats: Stats = { numbers, min: numbers[0] ?? 0, max: numbers[n - 1] ?? 0, average, deviation, counts };
  byTable.set(table, stats);
  return stats;
}

/** The p-th percentile (0 to 1) of sorted numbers by linear interpolation, as PERCENTILE.INC works. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const k = Math.min(1, Math.max(0, p)) * (sorted.length - 1);
  const lo = Math.floor(k);
  const hi = Math.ceil(k);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (k - lo);
}
