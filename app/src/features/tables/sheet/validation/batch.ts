// Evaluating many validation formulas in one recalculation: the circle-invalid pass on a long column must not
// rebuild the engine for every cell. Each target column gets one scratch column, and row r of it holds the formula
// of the cell (r, column).
import { isError, recalculate } from '../../engine';
import type { Cell, Value } from '../../engine';
import { remember, shiftedOf } from './operands';
import type { At, Context } from './types';

const EMPTY: Cell = { raw: '', value: null };

export interface Job {
  at: At;
  anchor: At;
  /** The formula as typed in the rule, with or without "=". */
  formula: string;
}

/**
 * Results are shared under `tag` ('n': operands; 'p': list sources). Sources are only shared when they came out as a
 * plain value: an array or an error may be a spill that this unpadded run could not show, so it is left to run alone.
 */
export function evalMany(ctx: Context, jobs: readonly Job[], tag: 'n' | 'p' = 'n'): Value[] {
  const { table } = ctx;
  const cols = [...new Set(jobs.map((j) => j.at.col))].sort((p, q) => p - q);
  const slot = new Map(cols.map((c, i) => [c, i]));
  const extra = cols.map((c) => ({ id: `__validation${c}`, name: `__validation${c}`, type: 'text' as const }));
  const shifted = new Map<string, string>();
  for (const job of jobs) {
    const moved = shiftedOf(ctx, job.formula, job.at, job.anchor);
    if (typeof moved === 'string') shifted.set(`${job.at.row}:${job.at.col}`, moved);
  }
  const rows = table.rows.map((row, r) => ({
    ...row,
    cells: [
      ...row.cells,
      ...cols.map((c): Cell => {
        const f = shifted.get(`${r}:${c}`);
        return f === undefined ? EMPTY : { raw: `=${f}`, value: null, formula: f };
      }),
    ],
  }));
  const done = recalculate({ ...table, columns: [...table.columns, ...extra], rows }, ctx.env);
  return jobs.map((job) => {
    const moved = shifted.get(`${job.at.row}:${job.at.col}`);
    if (moved === undefined) return { error: 'NAME' as const };
    const value = done.rows[job.at.row]?.cells[table.columns.length + (slot.get(job.at.col) ?? 0)]?.value ?? null;
    const plain = tag === 'n' || !(isError(value) || (value !== null && typeof value === 'object'));
    if (plain) remember(ctx, tag, moved, job.at, value);
    return value;
  });
}
