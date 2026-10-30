// Reads a tool's typed fields into values for its engine, and runs it. A field that can't be read is reported on
// that field, so the window can mark it, and the tool doesn't run until every shown field reads.
import { evaluate } from '../../../../core/expr';
import { MechError } from './errors';
import { shownFields, type Outcome, type ToolSpec, type Values } from './spec';
import { readQuantity, typedUnit, type System } from './units';

export interface FieldProblem {
  readonly field: string;
  readonly error: MechError;
}

export type Run =
  | { readonly ok: true; readonly outcome: Outcome; readonly values: Values }
  | { readonly ok: false; readonly fields: readonly FieldProblem[]; readonly error: MechError | null };

/** The first texts of a tool's fields. */
export function firstTexts(spec: ToolSpec): Record<string, string> {
  return Object.fromEntries(spec.fields.map((field) => [field.id, field.first]));
}

/** The values of the fields shown, read in the chosen system. */
export function readValues(spec: ToolSpec, texts: Readonly<Record<string, string>>, system: System) {
  const values: Record<string, number | string> = {};
  for (const field of spec.fields) {
    const text = texts[field.id] ?? field.first;
    if (field.type === 'choice') values[field.id] = field.options.includes(text) ? text : field.first;
    else if (field.type === 'text') values[field.id] = text;
  }
  const problems: FieldProblem[] = [];
  for (const field of shownFields(spec, values)) {
    if (field.type !== 'quantity') continue;
    const text = (texts[field.id] ?? field.first).trim();
    if (text === '' && field.optional) {
      values[field.id] = Number.NaN;
      continue;
    }
    try {
      values[field.id] = readQuantity(text, field.kind, system);
    } catch (error) {
      if (!(error instanceof MechError)) throw error;
      problems.push({ field: field.id, error });
    }
  }
  return { values: values as Values, problems };
}

/** Reads the fields and runs the tool. */
export function runTool(spec: ToolSpec, texts: Readonly<Record<string, string>>, system: System): Run {
  const { values, problems } = readValues(spec, texts, system);
  if (problems.length > 0) return { ok: false, fields: problems, error: null };
  try {
    return { ok: true, outcome: spec.run(values, system), values };
  } catch (error) {
    // A slip in a tool must not take the window down; it reads as a problem that couldn't be worked out.
    return { ok: false, fields: [], error: error instanceof MechError ? error : new MechError('unknown') };
  }
}

/**
 * Before the unit system changes, a bare number gets the unit it was read in, so "100" in mm becomes "100 mm", and
 * the values, and so the results, stay the same while they are shown in the other system.
 */
export function pinUnits(
  spec: ToolSpec,
  texts: Readonly<Record<string, string>>,
  from: System,
): Record<string, string> {
  const out: Record<string, string> = { ...texts };
  for (const field of spec.fields) {
    if (field.type !== 'quantity') continue;
    const text = (texts[field.id] ?? field.first).trim();
    const unit = typedUnit(field.kind, from);
    if (text === '' || unit === '' || !evaluate(text).ok) continue;
    out[field.id] = `${text} ${unit}`;
  }
  return out;
}
