// Reads a tool's typed fields into values for its engine, and runs it. A field that cannot be read is reported on
// that field, so the window can mark it, and the tool is not run until every shown field reads.
import { SolidsError } from './types';
import { evaluate } from '../../../../core/expr';
import { endsInSign, fromShown, readQuantity, toShown, typedUnit, type System } from './units';
import { typedLines } from './lines';
import { shownFields, type Columns, type Outcome, type ToolSpec, type Values } from './spec';

export interface FieldProblem {
  readonly field: string;
  readonly error: SolidsError;
}

export type Run =
  | { readonly ok: true; readonly outcome: Outcome; readonly values: Values }
  | { readonly ok: false; readonly fields: readonly FieldProblem[]; readonly error: SolidsError | null };

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
      values[field.id] = NaN;
      continue;
    }
    try {
      values[field.id] = readQuantity(text, field.kind, system);
    } catch (error) {
      if (!(error instanceof SolidsError)) throw error;
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
    // A slip in a tool must not take the window down with it; it reads as a problem that could not be worked out.
    return { ok: false, fields: [], error: error instanceof SolidsError ? error : new SolidsError('unknown') };
  }
}

/** A number to 6 significant figures, without trailing zeros. */
const tidy = (value: number): string => String(Number(value.toPrecision(6)));

/**
 * A typed table with its numbers turned from one system's units into the other's, so the table still says the same
 * thing. Words that are not quantities, comment lines, and words that are not plain numbers are kept as typed.
 */
export function convertTable(text: string, columns: Columns, from: System, to: System): string {
  const lines = text.split(/\r?\n/);
  for (const { words, line } of typedLines(text)) {
    const kinds = columns(words);
    if (!words.some((word, i) => kinds[i] && Number.isFinite(Number(word)))) continue;
    const out = words.map((word, i) => {
      const kind = kinds[i];
      const value = Number(word);
      return kind && Number.isFinite(value) ? tidy(toShown(fromShown(value, kind, from), kind, to)) : word;
    });
    lines[line - 1] = out.join(' ');
  }
  return lines.join('\n');
}

/**
 * Before the unit system changes, a bare number gets the unit it was read in, so "100" in mm becomes "100 mm". The
 * numbers of a typed table are turned into the other system's units. So the values, and the results, stay the same
 * while they are shown in the other system.
 */
export function pinUnits(
  spec: ToolSpec,
  texts: Readonly<Record<string, string>>,
  from: System,
  to: System = from === 'si' ? 'us' : 'si',
): Record<string, string> {
  const out: Record<string, string> = { ...texts };
  for (const field of spec.fields) {
    const text = (texts[field.id] ?? field.first).trim();
    if (field.type === 'text') {
      if (field.columns && text !== '') out[field.id] = convertTable(text, field.columns, from, to);
      continue;
    }
    if (field.type !== 'quantity') continue;
    const unit = typedUnit(field.kind, from);
    if (text === '' || unit === '' || endsInSign(text) || !evaluate(text).ok) continue;
    out[field.id] = `${text} ${unit}`;
  }
  return out;
}
