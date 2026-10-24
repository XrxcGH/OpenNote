// Reads a tool's typed fields into values for its engine, and runs it. A field that cannot be read is reported on
// that field, so the window can mark it, and the tool is not run until every shown field reads.
import { cellNumber, columnNames } from './data';
import {
  COLUMN_SEPARATOR,
  columnList,
  shownFields,
  type Field,
  type Outcome,
  type ToolSpec,
  type Values,
} from './spec';
import { StatError } from './types';

export interface FieldProblem {
  readonly field: string;
  readonly error: StatError;
}

export type Run =
  | { readonly ok: true; readonly outcome: Outcome; readonly values: Values }
  | { readonly ok: false; readonly fields: readonly FieldProblem[]; readonly error: StatError | null };

/** The first texts of a tool's fields. */
export function firstTexts(spec: ToolSpec): Record<string, string> {
  return Object.fromEntries(spec.fields.map((field) => [field.id, field.first]));
}

function readNumber(field: Field & { type: 'number' }, text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') {
    if (field.optional) return NaN;
    throw new StatError('empty');
  }
  const value = cellNumber(trimmed);
  if (value === null || Number.isNaN(value)) throw new StatError('unreadable', trimmed);
  if (field.integer && !Number.isInteger(value)) throw new StatError('integer');
  if (field.min !== undefined && value < field.min) throw new StatError('atLeast', String(field.min));
  if (field.max !== undefined && value > field.max) throw new StatError('atMost', String(field.max));
  return value;
}

function readColumns(field: Field & { type: 'column' }, text: string, names: readonly string[]): string {
  const picked = columnList(text).filter((name) => names.includes(name));
  if (picked.length === 0 && !field.optional) throw new StatError(field.multi ? 'pickColumns' : 'pickColumn');
  return field.multi ? picked.join(COLUMN_SEPARATOR) : (picked[0] ?? '');
}

/** The values of the fields shown. */
export function readValues(spec: ToolSpec, texts: Readonly<Record<string, string>>) {
  const values: Record<string, number | string> = {};
  for (const field of spec.fields) {
    const text = texts[field.id] ?? field.first;
    if (field.type === 'choice') values[field.id] = field.options.includes(text) ? text : field.first;
    else if (field.type !== 'number') values[field.id] = text;
  }
  const problems: FieldProblem[] = [];
  const names = new Map<string, string[]>();
  for (const field of shownFields(spec, values)) {
    const text = texts[field.id] ?? field.first;
    try {
      if (field.type === 'number') values[field.id] = readNumber(field, text);
      else if (field.type === 'column') {
        if (!names.has(field.data)) names.set(field.data, columnNames(String(values[field.data] ?? '')));
        values[field.id] = readColumns(field, text, names.get(field.data) ?? []);
      }
    } catch (error) {
      if (!(error instanceof StatError)) throw error;
      problems.push({ field: field.id, error });
    }
  }
  return { values: values as Values, problems };
}

/** Reads the fields and runs the tool. */
export function runTool(spec: ToolSpec, texts: Readonly<Record<string, string>>): Run {
  const { values, problems } = readValues(spec, texts);
  if (problems.length > 0) return { ok: false, fields: problems, error: null };
  try {
    return { ok: true, outcome: spec.run(values), values };
  } catch (error) {
    // A slip in a tool must not take the window down with it; it reads as a problem that could not be worked out.
    return { ok: false, fields: [], error: error instanceof StatError ? error : new StatError('unknown') };
  }
}
