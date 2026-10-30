// How a tool describes itself to the window: its fields, and a function from their values to a result. The window
// draws every calculating tool from this, so each is an engine call and a spec, and the form, the units, the results,
// the steps and the Insert menu work the same everywhere. Words come from kitDesign.<tool> in the strings:
// field.<id>, option.<value>, row.<id>, word.<id>, col.<id>, table.<id>, note.<id>, example.<id>, plot.<id>.x/.y.
import type { DimId } from './units';

/** A field's value: a number in the engine's unit (NaN when an optional field is empty), a choice, or text. */
export type Values = Readonly<Record<string, number | string>>;

interface FieldBase {
  readonly id: string;
  /** Shown only when this says so. */
  readonly when?: (values: Values) => boolean;
}

export interface NumField extends FieldBase {
  readonly type: 'num';
  /** The quantity, which sets the units offered. A number without a unit leaves this out. */
  readonly dim?: DimId;
  /** The first text, in the unit the field starts with in SI. */
  readonly def: string;
  readonly optional?: boolean;
}

export interface ChoiceField extends FieldBase {
  readonly type: 'choice';
  readonly options: readonly string[];
  readonly def: string;
}

export interface TextField extends FieldBase {
  readonly type: 'text';
  readonly def: string;
  readonly rows: number;
}

export type Field = NumField | ChoiceField | TextField;

export interface Row {
  readonly id: string;
  readonly value?: number;
  /** The engine's unit for the value: it is shown in the chosen system's unit. */
  readonly dim?: DimId;
  /** A unit to write as it is, for a value the window does not convert. */
  readonly unit?: string;
  /** Text to show as it is, such as a bit pattern or a long decimal. */
  readonly text?: string;
  /** A word under word.<id> in the tool's strings, instead of a number. */
  readonly word?: string;
  /** The symbol in LaTeX, for the equation an answer inserts. */
  readonly sym?: string;
  /** Part of the answer line and the inserted equation. */
  readonly answer?: boolean;
  /** Significant figures. */
  readonly digits?: number;
}

export interface Table {
  readonly id: string;
  /** Column names under col.<id>. */
  readonly columns: readonly string[];
  /** Cells are text as it is written, or a number. */
  readonly rows: readonly (readonly (string | number)[])[];
}

export interface Plot {
  readonly id: string;
  readonly kind: 'line' | 'bars';
  /** Line: points as x, y. Bars: each bar's from, to and height. */
  readonly points: readonly (readonly [number, number])[];
  readonly bars?: readonly { readonly from: number; readonly to: number; readonly count: number }[];
  /** Vertical reference lines, such as limits. */
  readonly marks?: readonly number[];
}

export interface Step {
  /** A name under step.<key> in the strings. */
  readonly key: string;
  readonly latex: string;
}

export interface Outcome {
  readonly rows: readonly Row[];
  readonly steps: readonly Step[];
  readonly tables?: readonly Table[];
  /** Assumptions, under note.<id>. */
  readonly notes?: readonly string[];
  readonly plot?: Plot;
}

export type Result =
  | { readonly ok: true; readonly outcome: Outcome }
  | { readonly ok: false; readonly problem: string; readonly detail?: string };

export interface ToolSpec {
  readonly fields: readonly Field[];
  /** Works the tool out. Numbers arrive in the engine's units. */
  run(values: Values): Result;
  /** Ready-made examples: a name under example.<id> and the field texts it sets (in the first units). */
  readonly examples?: readonly { readonly id: string; readonly values: Readonly<Record<string, string>> }[];
}

export const shownFields = (spec: ToolSpec, values: Values): Field[] =>
  spec.fields.filter((field) => !field.when || field.when(values));
