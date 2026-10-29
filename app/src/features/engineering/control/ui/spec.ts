// How a tool of the dynamics and control kit describes itself to the window: its fields, and a function from their
// values to an outcome. The window draws every tool from this, so the form, the units, the results, the plots, the
// steps, and the Insert menu work the same everywhere. Words come from kitControl.<tool> in the strings:
// field.<id>, hint.<id>, option.<value>, row.<id>, col.<id>, table.<id>, plot.<id>, note.<id>, and example.<id>.
import type { Step } from '../lib/steps';
import type { Picture } from './plot';
import type { System, UnitKind } from './units';

/** What the fields hold: a number in SI (NaN when an optional one is empty) or text. */
export type Values = Readonly<Record<string, number | string>>;

interface FieldBase {
  readonly id: string;
  /** The text the field starts with. */
  readonly first: string;
  /** Shown only when this says so. */
  readonly when?: (texts: Readonly<Record<string, string>>) => boolean;
}

export interface NumberField extends FieldBase {
  readonly type: 'number';
  /** A physical quantity, shown in the chosen unit system. Without one the number has no unit or a fixed one. */
  readonly unit?: UnitKind;
  readonly optional?: boolean;
}

export interface TextField extends FieldBase {
  readonly type: 'text';
  /** More than one row makes a box for matrices and lists. */
  readonly rows?: number;
}

export interface ChoiceField extends FieldBase {
  readonly type: 'choice';
  readonly options: readonly string[];
}

export type Field = NumberField | TextField | ChoiceField;

/** A value in SI and its kind, shown in the chosen system. */
export interface Quantity {
  readonly si: number;
  readonly kind: UnitKind;
}

export interface Row {
  readonly id: string;
  /** The value as text, or a quantity the window shows in the chosen units. */
  readonly value: string | Quantity;
  /** Values for the row's label. */
  readonly vars?: Readonly<Record<string, string>>;
  /** The symbol in LaTeX and the value in LaTeX, for the equation an answer inserts. */
  readonly tex?: string;
  /** Part of the answer line and the inserted equation. */
  readonly answer?: boolean;
}

/** A column: an id under col.<id>, or a heading written as given (such as a state's name). */
export type Column = string | { readonly text: string };

export interface Table {
  readonly id: string;
  readonly columns: readonly Column[];
  readonly rows: readonly (readonly string[])[];
}

export interface Note {
  readonly id: string;
  readonly vars?: Readonly<Record<string, string>>;
}

export interface Outcome {
  readonly rows: readonly Row[];
  readonly steps: readonly Step[];
  readonly tables?: readonly Table[];
  readonly plots?: readonly Picture[];
  /** Assumptions and checks, under note.<id>. */
  readonly notes?: readonly Note[];
  /** The main result as LaTeX, for the equation insert. Without it the answer rows are used. */
  readonly latex?: string;
}

export interface ToolSpec {
  readonly fields: readonly Field[];
  /** Works the tool out. It throws a FieldProblem, ControlError, TFError, or MatError when it cannot. */
  run(values: Values, system: System): Outcome;
  /** Ready-made examples: a name under example.<id> and the field texts it sets. */
  readonly examples?: readonly { readonly id: string; readonly texts: Readonly<Record<string, string>> }[];
}

/** A problem with what one field holds. The code is a key under kitControl.errors, unless `key` names another. */
export class FieldProblem extends Error {
  constructor(
    readonly field: string,
    readonly code: string,
    readonly vars: Readonly<Record<string, string>> = {},
    readonly key = `kitControl.errors.${code}`,
  ) {
    super(code);
  }
}

/** The fields shown for these texts. */
export const shownFields = (spec: ToolSpec, texts: Readonly<Record<string, string>>): Field[] =>
  spec.fields.filter((field) => !field.when || field.when(texts));

/** The texts every field starts with. */
export const firstTexts = (spec: ToolSpec): Record<string, string> =>
  Object.fromEntries(spec.fields.map((field) => [field.id, field.first]));
