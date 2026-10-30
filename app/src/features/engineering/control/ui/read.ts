// Reads a tool's fields and runs it. Numbers are read in the chosen unit system and handed to the tool in SI; a
// field that cannot be read, or an engine that cannot go on, becomes a problem the window says in words.
import { ControlError } from '../lib/errors';
import { MatError } from '../lib/linalg';
import { TFError } from '../lib/tf';
import { FieldProblem, firstTexts, shownFields, type Outcome, type ToolSpec, type Values } from './spec';
import { readPlainNumber, readQuantity, toShown, type System } from './units';

/** A message: a key under kitControl and the values for it. */
export interface Problem {
  readonly key: string;
  readonly vars: Readonly<Record<string, string>>;
}

export type Run =
  | { readonly ok: true; readonly values: Values; readonly outcome: Outcome }
  | { readonly ok: false; readonly fields: readonly { field: string; problem: Problem }[]; readonly error?: Problem };

/** The words for anything a tool or engine threw. */
export function problemOf(error: unknown): Problem {
  if (error instanceof FieldProblem) return { key: error.key, vars: error.vars };
  if (error instanceof ControlError) return { key: `kitControl.errors.${error.code}`, vars: error.vars };
  if (error instanceof TFError) return { key: `kitControl.tfErrors.${error.code}`, vars: {} };
  if (error instanceof MatError) return { key: `kitControl.matErrors.${error.code}`, vars: {} };
  return { key: 'kitControl.errors.failed', vars: {} };
}

const codeOf = (error: unknown): string =>
  error instanceof ControlError || error instanceof TFError || error instanceof MatError ? error.code : '';

/**
 * Runs `read` and marks what it throws as a problem with a field: the field `byCode` names for the error's code,
 * or else `field`. With no field the problem is the tool's as a whole.
 */
export function inField<T>(field: string | null, read: () => T, byCode: Readonly<Record<string, string>> = {}): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof FieldProblem) throw error;
    const target = byCode[codeOf(error)] ?? field;
    if (target === null) throw error;
    const { key, vars } = problemOf(error);
    throw new FieldProblem(target, key.slice(key.lastIndexOf('.') + 1), vars, key);
  }
}

export function runTool(spec: ToolSpec, texts: Readonly<Record<string, string>>, system: System): Run {
  const all = { ...firstTexts(spec), ...texts };
  const values: Record<string, number | string> = {};
  const fields: { field: string; problem: Problem }[] = [];
  for (const field of shownFields(spec, all)) {
    const text = all[field.id] ?? '';
    if (field.type !== 'number') {
      values[field.id] = field.type === 'choice' && !field.options.includes(text) ? field.first : text;
      continue;
    }
    try {
      if (field.optional && text.trim() === '') values[field.id] = Number.NaN;
      else
        values[field.id] = field.unit
          ? readQuantity(text, field.unit, system, field.id)
          : readPlainNumber(text, field.id);
    } catch (error) {
      fields.push({ field: field.id, problem: problemOf(error) });
    }
  }
  if (fields.length) return { ok: false, fields };
  try {
    return { ok: true, values, outcome: spec.run(values, system) };
  } catch (error) {
    if (error instanceof FieldProblem && shownFields(spec, all).some((f) => f.id === error.field)) {
      return { ok: false, fields: [{ field: error.field, problem: problemOf(error) }] };
    }
    return { ok: false, fields: [], error: problemOf(error) };
  }
}

/** The texts with every plain number of a unit field rewritten in the new system, so the values stay the same. */
export function pinUnits(
  spec: ToolSpec,
  texts: Readonly<Record<string, string>>,
  from: System,
  to: System,
): Record<string, string> {
  const next: Record<string, string> = { ...texts };
  for (const field of spec.fields) {
    if (field.type !== 'number' || !field.unit) continue;
    const text = texts[field.id] ?? field.first;
    if (!/^\s*[-−+]?[\d.]+(e[-+]?\d+)?\s*$/i.test(text)) continue;
    try {
      const si = readQuantity(text, field.unit, from, field.id);
      next[field.id] = String(Number(toShown(si, field.unit, to).toPrecision(6)));
    } catch {
      // A field that cannot be read stays as typed.
    }
  }
  return next;
}
