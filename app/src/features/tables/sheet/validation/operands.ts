// Reading the operands of a rule: constants, formulas relative to the rule's anchor cell, list items, and the
// numbers, dates, and times that typed text means. A formula runs in the engine on a scratch copy of the table that
// holds one extra column, so it sees the same cells, names, and functions as every formula of the table.
import { checkFormulaInput, makeCell, parseDate, parseIsoDate, parseLocaleNumber, recalculate } from '../../engine';
import type { Cell, Value } from '../../engine';
import { isError } from '../../engine';
import { shiftFormula } from '../../smart/fill';
import { columnFromLetters } from '../../../../core/expr';
import type { At, Context } from './types';

const EMPTY: Cell = { raw: '', value: null };
const PAD_ROWS = 1000;

/** The table with `candidate` typed into `at`, plus a column that holds `formula` (stored form) in row `at.row`. */
function scratch(ctx: Context, at: At, formula: string, candidate: string | undefined, pad: boolean) {
  const { table, locale } = ctx;
  const extra = { id: '__validation', name: '__validation', type: 'text' as const };
  const blank = Array.from({ length: pad ? PAD_ROWS : 0 }, (_, i) => ({
    id: `__pad${i}`,
    cells: [...table.columns.map(() => EMPTY), EMPTY],
  }));
  const rows = table.rows.map((row, r) => {
    const cells = [...row.cells];
    if (r === at.row && candidate !== undefined) {
      const column = table.columns[at.col];
      cells[at.col] = column.formula === undefined ? makeCell(column, candidate, locale, false) : cells[at.col];
    }
    cells.push(r === at.row ? { raw: `=${formula}`, value: null, formula } : EMPTY);
    return { ...row, cells };
  });
  return recalculate({ ...table, columns: [...table.columns, extra], rows: [...rows, ...blank] }, ctx.env);
}

/**
 * Evaluates formula text (typed form, with or without "=") as if it were written in `anchor`'s cell and the rule
 * were copied to `at`: relative references move with the cell (Excel's rule for a validation formula).
 */
export function evalFormula(ctx: Context, text: string, at: At, anchor: At, candidate?: string, pad = false): Value {
  const typed = text.trim().replace(/^=/, '');
  const stored = checkFormulaInput(typed, ctx.locale, ctx.table);
  if (typeof stored !== 'string') return { error: 'NAME' };
  const shifted = shiftFormula(stored, at.row - anchor.row, at.col - anchor.col);
  if (shifted === null) return { error: 'REF' };
  const done = scratch(ctx, at, shifted, candidate, pad);
  const value = done.rows[at.row]?.cells[done.columns.length - 1]?.value ?? null;
  return value;
}

const TIME = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i;

/** A time of day as a fraction of a day, or null. "9:30 pm" and "21:30" both read. */
export function parseTime(text: string): number | null {
  const m = TIME.exec(text.trim());
  if (!m) return null;
  let hours = Number(m[1]);
  const minutes = Number(m[2]);
  const seconds = Number(m[3] ?? 0);
  const meridian = m[4]?.toLowerCase();
  if (meridian) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (meridian === 'pm' ? 12 : 0);
  }
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return (hours * 3600 + minutes * 60 + seconds) / 86400;
}

export type Kind = 'whole' | 'decimal' | 'date' | 'time' | 'textLength';

/** What typed text means for a kind: a number, a date serial, a fraction of a day, or a length. Null when it isn't one. */
export function readText(kind: Kind, text: string, ctx: Context): number | null {
  const t = text.trim();
  if (kind === 'textLength') return [...text].length;
  if (kind === 'date') {
    const d = parseDate(t, ctx.locale.dateOrder) ?? parseIsoDate(t);
    if (d !== null) return d;
  }
  if (kind === 'time') {
    const f = parseTime(t);
    if (f !== null) return f;
  }
  const n = parseLocaleNumber(t, ctx.locale);
  if (n === null) return null;
  return n.percent ? n.value / 100 : n.value;
}

/** An operand's number: a formula's value, or the constant read as the kind reads text. Null when it isn't readable. */
export function readValue(kind: Kind, v: Value, ctx: Context): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return readText(kind, v, ctx);
  if (v !== null && typeof v === 'object' && 'kind' in v && v.kind === 'array') return readValue(kind, v.data[0], ctx);
  return null;
}

export function operand(
  ctx: Context,
  kind: Kind,
  text: unknown,
  at: At,
  anchor: At,
  candidate?: string,
): number | null {
  if (typeof text !== 'string' || text.trim() === '') return null;
  if (text.trim().startsWith('=')) {
    const v = evalFormula(ctx, text, at, anchor, candidate);
    return isError(v) ? null : readValue(kind === 'textLength' ? 'decimal' : kind, v, ctx);
  }
  return readText(kind === 'textLength' ? 'decimal' : kind, text, ctx);
}

/** A value as the text a cell would show for it: numbers use the region's decimal mark. */
export function scalarText(v: Value, ctx: Context): string {
  if (v === null) return '';
  if (typeof v === 'number') return String(v).replace('.', ctx.locale.decimal);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'string') return v;
  return '';
}

const RANGE = /^=?\s*\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?\s*$/;

/** The items of a list rule at `at`: typed items, or the values of the cells (or the formula) the source names. */
export function listItems(ctx: Context, rule: Record<string, unknown>, at: At, anchor: At): string[] {
  if (Array.isArray(rule.items)) return rule.items.filter((x): x is string => typeof x === 'string' && x !== '');
  if (typeof rule.source !== 'string') return [];
  let source = rule.source.trim();
  const shifted = shiftFormula(source.replace(/^=/, ''), at.row - anchor.row, at.col - anchor.col);
  if (shifted !== null && RANGE.test(shifted)) source = shifted;
  const m = RANGE.exec(source);
  const out: string[] = [];
  if (m) {
    const c1 = columnFromLetters(m[1]);
    const c2 = m[3] ? columnFromLetters(m[3]) : c1;
    const r1 = Number(m[2]) - 1;
    const r2 = m[4] ? Number(m[4]) - 1 : r1;
    for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++)
      for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
        const cell = ctx.table.rows[r]?.cells[c];
        if (cell) out.push(scalarText(cell.value, ctx));
      }
  } else {
    const v = evalFormula(ctx, source, at, anchor, undefined, true);
    if (v !== null && typeof v === 'object' && 'kind' in v && v.kind === 'array')
      for (const x of v.data) out.push(scalarText(x, ctx));
    else if (!isError(v)) out.push(scalarText(v, ctx));
  }
  return out.filter((x) => x !== '').slice(0, 1000);
}
