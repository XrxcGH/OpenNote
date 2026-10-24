// What was typed in a calculation's fields, read into numbers in base units. Pure, so a test can run every
// calculation from its first values. A problem names the field it came from, so the window can mark that field.
import type { Calc, Field, Input, Vars } from '../core/types';
import { toBase, unitsOf } from '../core/units';
import type { Quantity } from '../core/units';

export interface FieldState {
  text: Readonly<Record<string, string>>;
  /** Units by field id, and by `id.column` for table columns. */
  unit: Readonly<Record<string, string>>;
}

export type Parsed =
  { ok: true; input: Input } | { ok: false; field: string; key: string; vars: Vars & { field: string } };

/** A typed number: null when empty, NaN when it is not a number. Takes 1e-4, 1.5×10^-4, and a Unicode minus. */
export function readNumber(raw: string): number | null {
  const text = raw
    .trim()
    .replace(/[−–]/g, '-')
    .replace(/\s*[×x*]\s*10\^?\s*/i, 'e');
  if (text === '') return null;
  return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(text) ? Number(text) : NaN;
}

/** The fields a calculation shows for the choices made in its lists. */
export function fieldsOf(calc: Calc, state: FieldState): readonly Field[] {
  if (typeof calc.fields !== 'function') return calc.fields;
  const first = calc.fields({});
  const choices: Record<string, string> = {};
  for (const field of first) if (field.kind === 'select') choices[field.id] = state.text[field.id] ?? field.initial;
  return calc.fields(choices);
}

/** The first text and units of every field a calculation can show. */
export function initialState(calc: Calc): FieldState {
  const text: Record<string, string> = {};
  const unit: Record<string, string> = {};
  const add = (fields: readonly Field[]) => {
    for (const field of fields) {
      if (!(field.id in text)) text[field.id] = field.initial;
      if (field.kind === 'table')
        field.columns.forEach((c, i) => c.quantity && (unit[`${field.id}.${i}`] ??= unitsOf(c.quantity)[0]!));
      else if (field.kind !== 'select' && field.quantity) unit[field.id] ??= unitsOf(field.quantity)[0]!;
    }
  };
  add(fieldsOf(calc, { text, unit }));
  return { text, unit };
}

const toSi = (q: Quantity | undefined, value: number, sym: string | undefined) =>
  q ? toBase(q, value, sym ?? unitsOf(q)[0]!) : value;

function readTable(field: Extract<Field, { kind: 'table' }>, state: FieldState): Parsed | number[][] {
  const lines = (state.text[field.id] ?? field.initial)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const rows: number[][] = [];
  for (const [index, line] of lines.entries()) {
    const cells = line.split(/[\s,;]+/).map(readNumber);
    if (cells.length !== field.columns.length || cells.some((v) => v === null || Number.isNaN(v)))
      return bad(field, 'errors.row', { row: index + 1, count: field.columns.length });
    rows.push(cells.map((v, i) => toSi(field.columns[i]!.quantity, v!, state.unit[`${field.id}.${i}`])));
  }
  if (rows.length < (field.minRows ?? 1)) return bad(field, 'errors.rows', { count: field.minRows ?? 1 });
  return rows;
}

const bad = (field: Field, key: string, vars: Record<string, number | string> = {}): Parsed => ({
  ok: false,
  field: field.id,
  key,
  vars: { ...vars, field: field.label },
});

/** Reads every field. The first one that cannot be read is the problem. */
export function parseFields(fields: readonly Field[], state: FieldState): Parsed {
  const n: Record<string, number> = {};
  const o: Record<string, number | null> = {};
  const s: Record<string, string> = {};
  const rows: Record<string, number[][]> = {};
  for (const field of fields) {
    if (field.kind === 'select') {
      s[field.id] = state.text[field.id] ?? field.initial;
      continue;
    }
    if (field.kind === 'table') {
      const table = readTable(field, state);
      if (!Array.isArray(table)) return table;
      rows[field.id] = table;
      continue;
    }
    const value = readNumber(state.text[field.id] ?? field.initial);
    if (value === null) {
      if (field.optional) {
        o[field.id] = null;
        continue;
      }
      return bad(field, 'errors.empty');
    }
    if (Number.isNaN(value)) return bad(field, 'errors.notNumber');
    const si = toSi(field.quantity, value, state.unit[field.id]);
    n[field.id] = si;
    o[field.id] = si;
  }
  return { ok: true, input: { n, o, s, rows } };
}
