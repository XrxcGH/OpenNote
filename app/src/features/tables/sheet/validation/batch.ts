// Evaluating many validation formulas in one recalculation: the circle-invalid pass on a long column must not
// rebuild the engine for every cell. Each target column gets one scratch column, and row r of it holds the formula
// of the cell (r, column).
import { checkFormulaInput, recalculate } from '../../engine';
import type { Cell, Value } from '../../engine';
import { shiftFormula } from '../../smart/fill';
import type { At, Context } from './types';

const EMPTY: Cell = { raw: '', value: null };

export interface Job {
  at: At;
  anchor: At;
  /** The formula as typed in the rule, with or without "=". */
  formula: string;
}

export function evalMany(ctx: Context, jobs: readonly Job[]): Value[] {
  const { table, locale } = ctx;
  const cols = [...new Set(jobs.map((j) => j.at.col))].sort((p, q) => p - q);
  const slot = new Map(cols.map((c, i) => [c, i]));
  const extra = cols.map((c) => ({ id: `__validation${c}`, name: `__validation${c}`, type: 'text' as const }));
  const shifted = new Map<string, string>();
  for (const job of jobs) {
    const stored = checkFormulaInput(job.formula.trim().replace(/^=/, ''), locale, table);
    if (typeof stored !== 'string') continue;
    const moved = shiftFormula(stored, job.at.row - job.anchor.row, job.at.col - job.anchor.col);
    if (moved !== null) shifted.set(`${job.at.row}:${job.at.col}`, moved);
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
    if (!shifted.has(`${job.at.row}:${job.at.col}`)) return { error: 'NAME' as const };
    return done.rows[job.at.row]?.cells[table.columns.length + (slot.get(job.at.col) ?? 0)]?.value ?? null;
  });
}
