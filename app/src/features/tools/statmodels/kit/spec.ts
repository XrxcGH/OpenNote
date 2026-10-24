// How a tool describes itself to the window: its fields, and a function from their values to an outcome. The
// window draws every tool from this, so each tool is an engine and a spec, and the form, the data, the results,
// the steps, and the Insert menu work the same everywhere. Words come from kitStatModels.<tool> in the strings:
// field.<id>, option.<value>, hint.<id>, row.<id>, col.<id>, table.<id>, note.<id>, plot.<id> and picture.<id>.
import type { DrawContext, PlotSpec } from './picture';
import type { KitStep, StepValue } from './types';

/** A field's value: a number (NaN when an optional one is empty), a choice, text, or column names. */
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
  readonly integer?: boolean;
  /** The smallest and largest values allowed, inclusive. */
  readonly min?: number;
  readonly max?: number;
}

export interface ChoiceField extends FieldBase {
  readonly type: 'choice';
  readonly options: readonly string[];
  readonly first: string;
}

/** Free text the tool reads with its own parser, such as a model formula or a list of arrows. */
export interface TextField extends FieldBase {
  readonly type: 'text';
  readonly first: string;
  readonly rows: number;
}

/** A table of data, pasted, or opened from a CSV or TSV file. */
export interface DataField extends FieldBase {
  readonly type: 'data';
  readonly first: string;
  readonly rows: number;
}

/** One column, or several, of a data field, picked by name. */
export interface ColumnField extends FieldBase {
  readonly type: 'column';
  /** The id of the data field the columns come from. */
  readonly data: string;
  readonly first: string;
  readonly optional?: boolean;
  readonly multi?: boolean;
}

export type Field = NumberField | ChoiceField | TextField | DataField | ColumnField;

/** Several column names are kept in one value, a line each. */
export const COLUMN_SEPARATOR = '\n';

export const columnList = (value: number | string | undefined): string[] =>
  typeof value === 'string' && value !== '' ? value.split(COLUMN_SEPARATOR).filter((name) => name !== '') : [];

export interface ResultRow {
  readonly id: string;
  /** A number or text; or else `word`, a word under word.<id> in the tool's strings. */
  readonly value?: StepValue;
  readonly word?: string;
  /** The symbol in LaTeX, for the equation an answer inserts. */
  readonly sym?: string;
  /** Part of the answer line and the inserted equation. */
  readonly answer?: boolean;
}

export interface ResultTable {
  readonly id: string;
  /** Column ids under col.<id> in the tool's strings, or =text for a name from the data, such as a group. */
  readonly columns: readonly string[];
  readonly rows: readonly (readonly StepValue[])[];
}

export type Picture =
  | { readonly id: string; readonly type: 'plot'; readonly plot: PlotSpec }
  | { readonly id: string; readonly type: 'draw'; readonly draw: (ctx: DrawContext) => string };

export interface Outcome {
  readonly rows: readonly ResultRow[];
  readonly steps: readonly KitStep[];
  readonly tables?: readonly ResultTable[];
  readonly notes?: readonly string[];
  readonly pictures?: readonly Picture[];
  /** The fitted equation in LaTeX, when the tool has one. */
  readonly equation?: string;
  /** A paragraph that reports the result in words, as a step under the tool's step strings. */
  readonly words?: KitStep;
}

export interface ToolSpec {
  readonly fields: readonly Field[];
  /** Works the tool out. It throws a StatError when the inputs cannot give an answer. */
  run(values: Values): Outcome;
  /** Ready-made examples: a name under example.<id> and the field texts it sets. */
  readonly examples?: readonly { readonly id: string; readonly values: Readonly<Record<string, string>> }[];
  /** Says on screen that the tool is for coursework, not clinical, or financial decisions. */
  readonly caution?: boolean;
}

/** The fields shown for these values. */
export const shownFields = (spec: ToolSpec, values: Values): Field[] =>
  spec.fields.filter((field) => !field.when || field.when(values));
