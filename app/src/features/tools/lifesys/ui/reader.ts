// Reads a form's typed values for an engine: numbers in the base unit of their field's group, choices, text and
// pasted rows. Each problem throws LsError, naming the field, so the window can say what to fix.
import { LsError } from '../num/errors';
import type { FieldSpec, Reader } from '../types';
import { UNIT_GROUPS, toBase } from '../units';
import type { Values } from './fields';
import { parseNumber, parseRows } from './text';
import { word } from './words';

export function makeReader(fields: readonly FieldSpec[], values: Values): Reader {
  const field = (id: string): FieldSpec => {
    const found = fields.find((f) => f.id === id);
    if (!found) throw new LsError('errors.unknown');
    return found;
  };
  const opt = (id: string): number | null => {
    const f = field(id);
    const value = parseNumber(values.text[id] ?? '');
    if (value === null) return null;
    if (Number.isNaN(value)) throw new LsError('errors.notNumber', { name: word(f.label) });
    if (!f.unit) return value;
    return toBase(f.unit, values.unit[id] ?? f.unitInitial ?? UNIT_GROUPS[f.unit][0].id, value);
  };
  const table = (id: string, labeled: boolean) => {
    const f = field(id);
    const parsed = parseRows(values.text[id] ?? '', labeled);
    if (parsed.bad > 0) throw new LsError('errors.badRows', { name: word(f.label), count: parsed.bad });
    if (parsed.rows.length === 0) throw new LsError('errors.missing', { name: word(f.label) });
    return { labels: parsed.labels, rows: parsed.rows };
  };
  return {
    opt,
    num(id) {
      const value = opt(id);
      if (value === null) throw new LsError('errors.missing', { name: word(field(id).label) });
      return value;
    },
    choice: (id) => values.text[id] ?? field(id).options?.[0]?.value ?? '',
    text: (id) => values.text[id] ?? '',
    rows: (id) => table(id, false).rows,
    table: (id) => table(id, true),
  };
}

/** The values a form starts with: each field's initial text, and each unit field's first unit. */
export function initialValues(fields: readonly FieldSpec[]): Values {
  return {
    text: Object.fromEntries(
      fields.map((f) => [f.id, f.initial ?? (f.kind === 'select' ? (f.options?.[0]?.value ?? '') : '')]),
    ),
    unit: Object.fromEntries(
      fields.filter((f) => f.unit).map((f) => [f.id, f.unitInitial ?? UNIT_GROUPS[f.unit!][0].id]),
    ),
  };
}
