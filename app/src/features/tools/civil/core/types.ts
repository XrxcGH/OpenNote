// The shapes the civil, environmental, and chemical engineering tools share. Engines and calculations are pure: they
// return message keys (relative to the kitCivil strings) with values, never translated text, so the window words
// them and a test can check the numbers.
import type { Quantity } from './units';

export type Vars = Readonly<Record<string, number | string>>;

/** A sentence for the person: a key under kitCivil and the values it shows. */
export interface Msg {
  key: string;
  vars?: Vars;
}

/** One worked step: the sentence, and the equation with numbers in LaTeX when there is one. */
export interface KitStep extends Msg {
  math?: string;
}

/** Input that cannot work, such as a negative depth. The key names the sentence that says why. */
export class CivilError extends Error {
  constructor(
    readonly key: string,
    readonly vars: Vars = {},
  ) {
    super(key);
    this.name = 'CivilError';
  }
}

/** Throws a CivilError unless the condition holds. */
export function need(condition: boolean, key: string, vars?: Vars): asserts condition {
  if (!condition) throw new CivilError(key, vars);
}

export interface Series {
  /** The key of the series' name in the legend. */
  name: string;
  points: readonly (readonly [number, number])[];
  style?: 'line' | 'points' | 'dashed';
}

export interface Plot {
  /** The key of the plot's title, also its accessible name. */
  title: string;
  x: string;
  y: string;
  xLog?: boolean;
  yLog?: boolean;
  /** Depth plots run downward. */
  yDown?: boolean;
  /** One unit on x is as long as one unit on y, for circles and plans. */
  equal?: boolean;
  series: readonly Series[];
}

export interface Row {
  /** The key of the quantity's name. */
  label: string;
  value: number | string;
  unit?: string;
}

export interface Grid {
  caption: string;
  /** Keys of the column names. */
  header: readonly string[];
  rows: readonly (readonly (number | string)[])[];
}

export interface Outcome {
  answer: Msg;
  rows: readonly Row[];
  steps: readonly KitStep[];
  /** The governing equation with its numbers, for Insert LaTeX. */
  latex?: string;
  plot?: Plot;
  grid?: Grid;
  notes?: readonly Msg[];
  /** The key of the source line shown under the result. */
  source?: string;
}

interface FieldBase {
  id: string;
  /** The key of the field's label. */
  label: string;
  help?: string;
}

export interface NumberField extends FieldBase {
  kind?: 'number';
  quantity?: Quantity;
  initial: string;
  /** The unit the field starts in, when not the quantity's base unit. */
  unit?: string;
  /** Left empty, the calculation gets null instead of an error. */
  optional?: boolean;
}

export interface SelectField extends FieldBase {
  kind: 'select';
  options: readonly { value: string; label: string }[];
  initial: string;
}

export interface TableField extends FieldBase {
  kind: 'table';
  columns: readonly { label: string; quantity?: Quantity }[];
  /** Rows of numbers, one row per line. */
  initial: string;
  minRows?: number;
}

/** A short formula, such as a rate law in C. The calculation reads it with core/expr; it is never run as code. */
export interface TextField extends FieldBase {
  kind: 'text';
  initial: string;
}

export type Field = NumberField | SelectField | TableField | TextField;

/** What the window read from the fields: numbers in the base unit of their quantity. */
export interface Input {
  n: Readonly<Record<string, number>>;
  /** Optional numbers, null when empty. */
  o: Readonly<Record<string, number | null>>;
  s: Readonly<Record<string, string>>;
  rows: Readonly<Record<string, readonly (readonly number[])[]>>;
}

export interface Calc {
  id: string;
  /** The key of its name in the Calculation list. */
  title: string;
  intro?: string;
  fields: readonly Field[] | ((choices: Readonly<Record<string, string>>) => readonly Field[]);
  solve(input: Input): Outcome;
}
