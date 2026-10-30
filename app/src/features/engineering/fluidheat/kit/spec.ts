// How a tool describes itself to the window: its fields, and a function from their values to an outcome. The
// window draws every tool from this, so each tool is an engine and a spec, and the form, the units, the results, the
// steps, and the Insert menu work the same everywhere. Words come from kitFluidHeat.<tool> in the strings:
// field.<id>, option.<value>, hint.<id>, row.<id>, col.<id>, note.<id>, and plot.<id>.
import type { DrawContext, PlotSpec } from './picture';
import type { KitStep, StepValue } from './types';
import type { Kind, System } from './units';

/** A field's value: a quantity in base SI (NaN when an optional one is empty), a choice, or text. */
export type Values = Readonly<Record<string, number | string>>;

interface FieldBase {
  readonly id: string;
  /** Shown only when this says so. */
  readonly when?: (values: Values) => boolean;
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

export interface TextAreaField extends FieldBase {
  readonly type: 'text';
  readonly first: string;
  readonly rows: number;
}

export type Field = QuantityField | ChoiceField | TextAreaField;

export interface ResultRow {
  readonly id: string;
  /** A number or quantity; or else `word`, a word under word.<id> in the tool's strings. */
  readonly value?: StepValue;
  readonly word?: string;
  /** The symbol in LaTeX, for the equation an answer inserts. */
  readonly sym?: string;
  /** Part of the answer line and the inserted equation. */
  readonly answer?: boolean;
}

export interface ResultTable {
  readonly id: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly StepValue[])[];
}

export type Picture =
  | { readonly type: 'plot'; readonly plot: PlotSpec }
  | { readonly type: 'draw'; readonly draw: (ctx: DrawContext) => string };

export interface Outcome {
  readonly rows: readonly ResultRow[];
  readonly steps: readonly KitStep[];
  readonly tables?: readonly ResultTable[];
  readonly notes?: readonly string[];
  readonly picture?: Picture;
}

export interface ToolSpec {
  readonly fields: readonly Field[];
  /** Works the tool out. It throws a FluidHeatError when the inputs cannot give an answer. */
  run(values: Values, system: System): Outcome;
  /** Ready-made examples: a name under example.<id> and the field texts it sets. */
  readonly examples?: readonly { readonly id: string; readonly values: Readonly<Record<string, string>> }[];
}

/** The fields shown for these values. */
export const shownFields = (spec: ToolSpec, values: Values): Field[] =>
  spec.fields.filter((field) => !field.when || field.when(values));
