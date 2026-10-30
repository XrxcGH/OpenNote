// How a tool describes itself to the window: its fields and a function from their values to an outcome. The window
// draws every tool from this, so the form, the units, the results, the steps, the plots, and the Insert menu work
// the same everywhere. Words come from kitMechDyn.<tool> in the strings: field.<id>, option.<value>, hint.<id>,
// row.<id>, word.<id>, note.<id>, table.<id>, col.<id>, and example.<id>.
import type { MechStep, Plot } from '../types';
import type { Cell } from './format';
import type { Kind, System } from './units';

/** A field's value: a quantity in base SI (NaN when an optional one is empty), a choice, or text. */
export type Values = Readonly<Record<string, number | string>>;

interface FieldBase {
  readonly id: string;
  /** Shown only when this says so. */
  readonly when?: (values: Values) => boolean;
  /** A hint under the field, from hint.<id>. */
  readonly hint?: boolean;
}

export interface QuantityField extends FieldBase {
  readonly type: 'quantity';
  readonly kind: Kind;
  /** The first text, with its unit, so it reads the same in either system. */
  readonly first: string;
  readonly optional?: boolean;
}

export interface ChoiceField extends FieldBase {
  readonly type: 'choice';
  readonly options: readonly string[];
  readonly first: string;
}

/** Text: one line (a formula) or several (a table typed row by row). */
export interface TextField extends FieldBase {
  readonly type: 'text';
  readonly first: string;
  readonly rows?: number;
}

export type Field = QuantityField | ChoiceField | TextField;

export interface ResultRow {
  readonly id: string;
  /** A number or quantity; or else `word`, a word under word.<id> in the tool's strings. */
  readonly value?: Cell;
  readonly word?: string;
  /** Values for the row label's placeholders, such as a mode number. */
  readonly vars?: Readonly<Record<string, string>>;
  /** The symbol in LaTeX, for the equation an answer inserts. */
  readonly sym?: string;
  /** Part of the answer line and the inserted equation. */
  readonly answer?: boolean;
}

export interface ResultTable {
  readonly id: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly Cell[])[];
}

export interface Outcome {
  readonly rows: readonly ResultRow[];
  readonly steps: readonly MechStep[];
  readonly tables?: readonly ResultTable[];
  /** Assumptions and checks, under note.<id>. */
  readonly notes?: readonly string[];
  readonly plots?: readonly Plot[];
  /** Where published constants came from. */
  readonly sources?: readonly string[];
  /** Frames of a drawing over a sweep or a run, each at an input angle (rad) or a time (s). */
  readonly animation?: Animation;
}

export interface Animation {
  readonly frames: readonly Plot[];
  readonly at: 'angle' | 'time';
  readonly values: readonly number[];
}

export interface ToolSpec {
  readonly fields: readonly Field[];
  /** Works the tool out. It throws a MechError when the inputs can't give an answer. */
  run(values: Values, system: System): Outcome;
  /** Ready-made examples: a name under example.<id> and the field texts it sets. */
  readonly examples?: readonly { readonly id: string; readonly values: Readonly<Record<string, string>> }[];
}

/** The fields shown for these values. */
export const shownFields = (spec: ToolSpec, values: Values): Field[] =>
  spec.fields.filter((field) => !field.when || field.when(values));

/** A number field's value; NaN for an optional one left empty. */
export const num = (values: Values, id: string): number => values[id] as number;

/** A choice or text field's value. */
export const str = (values: Values, id: string): string => String(values[id] ?? '');
