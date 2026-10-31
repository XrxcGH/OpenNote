// What a tool is to the window: some fields and a function from what was typed to an answer. The window draws the
// form, the answer, the tables, the pictures, the steps, and the Insert buttons, so a tool is only its fields and
// engine.
import type { MolToolId } from './meta';
import { KitError } from './shared';
import type { KitResult, MolKey, Values } from './shared';

export interface FieldOption {
  value: string;
  label: MolKey;
}

export interface Field {
  id: string;
  label: MolKey;
  /** The text the field starts with, which is also the worked example. */
  initial: string;
  /** A short number or word, a choice, or text on several lines (sequences, lists, and tables). */
  kind?: 'number' | 'text' | 'select' | 'area';
  options?: readonly FieldOption[];
  /** A fact about the input shown under the field. */
  hint?: MolKey;
  /** The field shows only for some choices in the other fields. */
  when?: (values: Values) => boolean;
}

export interface ToolSpec {
  id: MolToolId;
  fields: readonly Field[];
  run(values: Values): KitResult;
}

export const initialValues = (spec: ToolSpec): Values =>
  Object.fromEntries(spec.fields.map((field) => [field.id, field.initial]));

/** Runs a tool, turning a thrown input problem into a failure the window can say in words. */
export function runTool(spec: ToolSpec, values: Values): KitResult {
  try {
    return spec.run({ ...initialValues(spec), ...values });
  } catch (error) {
    if (error instanceof KitError) return { ok: false, error: error.key, vars: error.vars };
    throw error;
  }
}

/** A select field's options from a list of values whose labels share a key prefix. */
export const choices = (prefix: string, values: readonly string[]): FieldOption[] =>
  values.map((value) => ({ value, label: `${prefix}${value}` as MolKey }));
