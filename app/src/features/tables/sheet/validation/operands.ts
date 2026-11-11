// Reading the operands of a rule: constants, formulas relative to the rule's anchor cell, list items, and the
// numbers, dates, and times that typed text means. A formula runs in the engine on a scratch copy of the table that
// holds one extra column, so it sees the same cells, names, and functions as every formula of the table.
import { EN_US, checkFormulaInput, makeCell, parseDate, parseIsoDate, parseLocaleNumber, recalculate } from '../../engine';
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

/** Rules keep their formulas, numbers, dates, and times in the invariant form: English syntax, ".", ISO dates. */
export const INVARIANT = EN_US;

// Results of formulas that ran without a typed candidate, by table and shifted formula: a formula without relative
// references runs once for all the cells of a rule, and the circle pass fills in many cells in one recalculation.
const memo = new WeakMap<object, Map<string, unknown>>();
const VOLATILE = /\b(row|column)\s*\(/i;

const keyOf = (tag: string, shifted: string, at: At) =>
  `${tag}|${VOLATILE.test(shifted) ? `${at.row}:${at.col}|` : ''}${shifted}`;

export function recall<T = Value>(ctx: Context, tag: string, shifted: string, at: At): T | undefined {
  return memo.get(ctx.table)?.get(keyOf(tag, shifted, at)) as T | undefined;
}

export function remember(ctx: Context, tag: string, shifted: string, at: At, value: unknown): void {
  let m = memo.get(ctx.table);
  if (!m) memo.set(ctx.table, (m = new Map()));
  m.set(keyOf(tag, shifted, at), value);
}

/** A rule's formula (invariant form, with or without "=") as stored text moved from `anchor` to `at`. */
export function shiftedOf(ctx: Context, text: string, at: At, anchor: At): string | { error: 'NAME' | 'REF' } {
  const stored = checkFormulaInput(text.trim().replace(/^=/, ''), ctx.locale, ctx.table);
  if (typeof stored !== 'string') return { error: 'NAME' };
  return shiftFormula(stored, at.row - anchor.row, at.col - anchor.col) ?? { error: 'REF' };
}

/**
 * Evaluates a rule's formula (invariant form) as if it were written in `anchor`'s cell and the rule were copied to
 * `at`: relative references move with the cell. Without a candidate the result is shared by cells with one formula.
 */
export function evalFormula(ctx: Context, text: string, at: At, anchor: At, candidate?: string, pad = false): Value {
  const shifted = shiftedOf(ctx, text, at, anchor);
  if (typeof shifted !== 'string') return shifted;
  const tag = pad ? 'p' : 'n';
  if (candidate === undefined) {
    const hit = recall<Value>(ctx, tag, shifted, at);
    if (hit !== undefined) return hit;
  }
  const done = scratch(ctx, at, shifted, candidate, pad);
  const value = done.rows[at.row]?.cells[done.columns.length - 1]?.value ?? null;
  if (candidate === undefined) remember(ctx, tag, shifted, at, value);
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

/** What a rule's constant means: invariant form (ISO date, "13:30:00", "2.5"). Null when it isn't readable. */
export function readConstant(kind: Kind, text: string): number | null {
  const t = text.trim();
  if (kind === 'date') {
    const d = parseIsoDate(t) ?? parseDate(t, 'mdy');
    if (d !== null) return d;
  }
  if (kind === 'time') {
    const f = parseTime(t);
    if (f !== null) return f;
  }
  const n = parseLocaleNumber(t, INVARIANT);
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

/**
 * An operand's number: a formula's value, or the constant. Both are in the invariant form. A formula reads the sheet
 * as it is now, not with the text being typed, as in Excel, so its result is shared by cells that use one formula.
 */
export function operand(ctx: Context, kind: Kind, text: unknown, at: At, anchor: At): number | null {
  if (typeof text !== 'string' || text.trim() === '') return null;
  const k = kind === 'textLength' ? 'decimal' : kind;
  if (text.trim().startsWith('=')) {
    const v = evalFormula(ctx, text, at, anchor);
    return isError(v) ? null : readValue(k, v, ctx);
  }
  return readText(k, text, ctx);
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
const MAX_ITEMS = 1000;

/** The items of a list rule at `at`: typed items, or the values of the cells (or the formula) the source names. */
export function listItems(ctx: Context, rule: Record<string, unknown>, at: At, anchor: At): string[] {
  if (Array.isArray(rule.items)) return rule.items.filter((x): x is string => typeof x === 'string' && x !== '');
  if (typeof rule.source !== 'string') return [];
  let source = rule.source.trim();
  const shifted = shiftFormula(source.replace(/^=/, ''), at.row - anchor.row, at.col - anchor.col);
  if (shifted !== null && RANGE.test(shifted)) source = shifted;
  const m = RANGE.exec(source);
  if (m) {
    const cached = recall<string[]>(ctx, 'r', source, at);
    if (cached) return cached;
    const out: string[] = [];
    const c1 = columnFromLetters(m[1]);
    const c2 = m[3] ? columnFromLetters(m[3]) : c1;
    const r1 = Number(m[2]) - 1;
    const r2 = m[4] ? Number(m[4]) - 1 : r1;
    // Stay inside the table: a range may name far more cells than exist, and no list holds more than MAX_ITEMS.
    const lastRow = Math.min(Math.max(r1, r2), ctx.table.rows.length - 1);
    const lastCol = Math.min(Math.max(c1, c2), ctx.table.columns.length - 1);
    for (let r = Math.max(0, Math.min(r1, r2)); r <= lastRow && out.length < MAX_ITEMS; r++)
      for (let c = Math.max(0, Math.min(c1, c2)); c <= lastCol && out.length < MAX_ITEMS; c++) {
        const cell = ctx.table.rows[r]?.cells[c];
        const text = cell ? scalarText(cell.value, ctx) : '';
        if (text !== '' && !out.includes(text)) out.push(text);
      }
    remember(ctx, 'r', source, at, out);
    return out;
  }
  const v = evalFormula(ctx, source, at, anchor, undefined, true);
  const out: string[] = [];
  if (v !== null && typeof v === 'object' && 'kind' in v && v.kind === 'array') {
    for (const x of v.data) {
      const text = scalarText(x, ctx);
      if (text !== '' && !out.includes(text)) out.push(text);
      if (out.length >= MAX_ITEMS) break;
    }
  } else if (!isError(v) && scalarText(v, ctx) !== '') out.push(scalarText(v, ctx));
  return out;
}
