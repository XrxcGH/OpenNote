// Committing values under validation (DESIGN 13.4): typed values are checked when they are committed, and Stop
// refuses them, Warning asks first, Information only notes. Pasted values are checked and reported, never refused:
// they are kept, and "circle invalid data" shows them.
import { makeCell, recalculate, setCellInput } from '../../engine';
import type { Table } from '../../engine';
import { check, invalidCells } from './check';
import type { Invalid } from './check';
import type { At, Context, Verdict } from './types';

type Bad = Extract<Verdict, { ok: false }>;

/** What to do with typed text: take it, take it and show a note, ask first, or refuse it. */
export type Decision =
  | { kind: 'accept' }
  | { kind: 'note'; verdict: Bad }
  | { kind: 'confirm'; verdict: Bad }
  | { kind: 'refuse'; verdict: Bad };

/** A formula is not checked, as in Excel: validation guards what people type, and the formula's result is theirs. */
export function decide(ctx: Context, at: At, text: string): Decision {
  if (text.startsWith('=')) return { kind: 'accept' };
  const v = check(ctx, at, text);
  if (v.ok) return { kind: 'accept' };
  return { kind: v.alert === 'stop' ? 'refuse' : v.alert === 'warning' ? 'confirm' : 'note', verdict: v };
}

export interface Applied {
  table: Table;
  decision: Decision;
  /** False when the value was refused, or a warning was not confirmed: the cell keeps its old value. */
  kept: boolean;
}

/** Commits typed text into a cell. `confirm` answers a Warning (true keeps the value); no answer means no. */
export function applyEdit(ctx: Context, at: At, text: string, confirm?: (verdict: Bad) => boolean): Applied {
  const decision = decide(ctx, at, text);
  const keep =
    decision.kind === 'accept' ||
    decision.kind === 'note' ||
    (decision.kind === 'confirm' && confirm?.(decision.verdict) === true);
  if (!keep) return { table: ctx.table, decision, kept: false };
  return { table: setCellInput(ctx.table, { ...at, raw: text }, ctx.locale, ctx.env), decision, kept: true };
}

export interface Pasted {
  table: Table;
  /** The pasted cells that are not valid. They were kept. */
  invalid: Invalid[];
}

/** Puts pasted text in cells (never as formulas), then reports the cells that are not valid. */
export function applyPaste(ctx: Context, cells: readonly (At & { text: string })[]): Pasted {
  const table = ctx.table;
  const changed = new Map(cells.map((c) => [`${c.row}:${c.col}`, c.text]));
  const rows = table.rows.map((row, r) => ({
    ...row,
    cells: row.cells.map((cell, c) => {
      const text = changed.get(`${r}:${c}`);
      const column = table.columns[c];
      return text === undefined || column.formula !== undefined ? cell : makeCell(column, text, ctx.locale, false);
    }),
  }));
  const next = recalculate({ ...table, rows }, ctx.env);
  const after = { ...ctx, table: next };
  const top = Math.min(...cells.map((c) => c.row));
  const bottom = Math.max(...cells.map((c) => c.row));
  const left = Math.min(...cells.map((c) => c.col));
  const right = Math.max(...cells.map((c) => c.col));
  const invalid =
    cells.length === 0
      ? []
      : invalidCells(after, { top, bottom, left, right }).filter((i) => changed.has(`${i.row}:${i.col}`));
  return { table: next, invalid };
}
