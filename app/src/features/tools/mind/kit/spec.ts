// How a tool describes itself to the window: its fields, and a function from their values to an outcome. The
// window draws every tool from this, so each tool is an engine and a spec, and the form, the results, the steps,
// the pictures, and the Insert menu work the same everywhere. Words come from kitMind.<tool> in the strings:
// field.<id>, option.<value>, hint.<id>, row.<id>, col.<id>, table.<id>, note.<id>, plot.<id>, picture.<id>.
import type { PlotSpec, Palette } from './plot';
import { readNumber } from './parse';
import { MindError, type KitStep, type StepValue, type Vars } from './types';

/** A field's value: a number (NaN when an optional one is empty), a choice, or text. */
export type Values = Readonly<Record<string, number | string>>;

interface FieldBase {
  readonly id: string;
  /** Shown only when this says so. */
  readonly when?: (values: Values) => boolean;
}

export interface NumberField extends FieldBase {
  readonly type: 'number';
  readonly first: string;
  readonly optional?: boolean;
}

export interface ChoiceField extends FieldBase {
  readonly type: 'choice';
  readonly options: readonly string[];
  readonly first: string;
}

/** Text of several lines, such as a table, which the tool reads itself. */
export interface TextField extends FieldBase {
  readonly type: 'text';
  readonly first: string;
  readonly rows: number;
}

/** Text of one line, such as a list. */
export interface LineField extends FieldBase {
  readonly type: 'line';
  readonly first: string;
}

export type Field = NumberField | ChoiceField | TextField | LineField;

export interface ResultRow {
  readonly id: string;
  readonly value: StepValue;
  /** Values for the row's label, such as the cue it is about. */
  readonly vars?: Vars;
  /** The symbol in LaTeX, for the equation an answer inserts. */
  readonly sym?: string;
  /** Part of the answer line and the inserted equation. */
  readonly answer?: boolean;
}

/** A column's name: a key under col.<id>, or text the person typed, such as a category. */
export type Column = string | { readonly raw: string };

export interface ResultTable {
  readonly id: string;
  readonly columns: readonly Column[];
  readonly rows: readonly (readonly StepValue[])[];
}

export interface Note {
  readonly id: string;
  readonly vars?: Vars;
}

export interface Picture {
  readonly id: string;
  readonly plot?: PlotSpec;
  /** A drawing of its own, as SVG text, for pictures that are not plots. */
  readonly draw?: (palette: Palette, label: (id: string) => string) => string;
}

export interface Outcome {
  readonly rows: readonly ResultRow[];
  readonly steps: readonly KitStep[];
  readonly tables?: readonly ResultTable[];
  readonly notes?: readonly Note[];
  readonly pictures?: readonly Picture[];
}

export interface ToolSpec {
  readonly fields: readonly Field[];
  /** Works the tool out. It throws a MindError when the inputs cannot give an answer. */
  run(values: Values): Outcome;
  /** Ready-made examples: a name under example.<id> and the field texts it sets. */
  readonly examples?: readonly { readonly id: string; readonly values: Readonly<Record<string, string>> }[];
}

export type Run =
  | { readonly ok: true; readonly values: Values; readonly outcome: Outcome }
  | {
      readonly ok: false;
      readonly values: Values;
      readonly problems: ReadonlyMap<string, MindError>;
      readonly error?: MindError;
    };

/** The texts every field starts with. */
export const firstTexts = (spec: ToolSpec): Record<string, string> =>
  Object.fromEntries(spec.fields.map((field) => [field.id, field.first]));

/** The fields shown for these values. */
export const shownFields = (spec: ToolSpec, values: Values): Field[] =>
  spec.fields.filter((field) => !field.when || field.when(values));

/** Reads the texts into values and runs the tool, collecting the problems each field has. */
export function runTool(spec: ToolSpec, texts: Readonly<Record<string, string>>): Run {
  const raw: Record<string, number | string> = {};
  for (const field of spec.fields) raw[field.id] = texts[field.id] ?? field.first;
  const problems = new Map<string, MindError>();
  const values: Record<string, number | string> = { ...raw };
  for (const field of shownFields(spec, raw)) {
    if (field.type !== 'number') continue;
    const text = String(raw[field.id]).trim();
    if (text === '' && field.optional) values[field.id] = NaN;
    else if (text === '') problems.set(field.id, new MindError('empty', {}, field.id));
    else {
      const value = readNumber(text);
      if (Number.isNaN(value)) problems.set(field.id, new MindError('number', {}, field.id));
      values[field.id] = value;
    }
  }
  if (problems.size > 0) return { ok: false, values, problems };
  try {
    return { ok: true, values, outcome: spec.run(values) };
  } catch (error) {
    const problem = error instanceof MindError ? error : new MindError('failed');
    const shown = problem.field !== undefined && shownFields(spec, values).some((f) => f.id === problem.field);
    return shown
      ? { ok: false, values, problems: new Map([[problem.field!, problem]]) }
      : { ok: false, values, problems, error: problem };
  }
}

/** A number value, for engines. */
export const num = (values: Values, id: string): number => Number(values[id]);
/** A text or choice value, for engines. */
export const str = (values: Values, id: string): string => String(values[id] ?? '');
