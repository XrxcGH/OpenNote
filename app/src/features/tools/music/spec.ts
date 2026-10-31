// What a tool is to the window: a title, some fields, and a function from what was typed to an answer. The window
// draws the form, the result, the steps, and the Insert buttons, so a tool is only its fields and engine.
import type { FieldKey, KitResult, Values } from './shared';

export interface FieldOption {
  value: string;
  label: FieldKey;
  /** A name that is data (a scale or an instrument) shown as it is, instead of looking `label` up. */
  plain?: string;
}

export interface Field {
  id: string;
  label: FieldKey;
  /** The text the field starts with. */
  initial: string;
  /** A number with a unit (the unit may be left off), a choice, or text on several lines. */
  kind?: 'number' | 'select' | 'area' | 'text';
  options?: readonly FieldOption[];
  /** A fact about the input shown under the field. */
  hint?: FieldKey;
  /** The field shows only for some choices in the other fields. */
  when?: (values: Values) => boolean;
}

export interface ToolSpec {
  id: string;
  fields: readonly Field[];
  run(values: Values): KitResult;
}

export const initialValues = (spec: ToolSpec): Values =>
  Object.fromEntries(spec.fields.map((field) => [field.id, field.initial]));

/** Runs a tool, turning a thrown input problem into a failure the window can say in words. */
export function runTool(spec: ToolSpec, values: Values): KitResult {
  try {
    return spec.run(values);
  } catch (error) {
    if (error instanceof Error && 'key' in error && 'vars' in error) {
      const known = error as unknown as { key: never; vars: Record<string, string> };
      return { ok: false, error: known.key, vars: known.vars };
    }
    throw error;
  }
}

/** A select field: each option is a stored value and the label key that names it. */
export const choice = (
  id: string,
  label: FieldKey,
  initial: string,
  options: readonly (readonly [string, FieldKey])[],
  when?: Field['when'],
): Field => ({
  id,
  label,
  initial,
  kind: 'select',
  options: options.map(([value, name]) => ({ value, label: name })),
  ...(when ? { when } : {}),
});

/** A `when` that shows a field only for the given values of the mode field. */
export const only =
  (modeId: string, fallback: string, ...modes: string[]) =>
  (values: Values): boolean =>
    modes.includes(values[modeId] ?? fallback);

/** A select field whose options are names kept in data, such as the scales of a tradition. */
export const plainChoice = (
  id: string,
  label: FieldKey,
  initial: string,
  options: readonly (readonly [string, string])[],
  when?: Field['when'],
): Field => ({
  id,
  label,
  initial,
  kind: 'select',
  options: options.map(([value, plain]) => ({ value, label, plain })),
  ...(when ? { when } : {}),
});
