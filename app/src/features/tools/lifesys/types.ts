// What every life-systems engine returns and what every calculator form declares. Engines fill CalcResult with
// numbers, string keys, and LaTeX; the window turns the keys into words. Nothing here touches the DOM.
import type { LsKey, LsVars } from './num/errors';
import type { UnitGroup } from './units';

export type { LsKey, LsVars } from './num/errors';

/** One worked step: a sentence with its numbers, and optionally the same step as LaTeX for the page. */
export interface Step {
  key: LsKey;
  vars?: LsVars;
  math?: string;
}

/** A labeled result: a number with its unit, or a word such as "stable". */
export interface ResultRow {
  label: LsKey;
  vars?: LsVars;
  value: number | string;
  /** A word for the value, such as a stability class, shown in place of `value`. */
  word?: LsKey;
  /** Values for `word`, such as the two ends of a range. */
  wordVars?: LsVars;
  unit?: string;
  /** Significant figures to show (default 6). */
  digits?: number;
}

export interface Series {
  name: LsKey;
  vars?: LsVars;
  points: readonly (readonly [number, number])[];
  /** Lines, markers, or a dashed line; each series also differs in dash pattern, so color is never the only cue. */
  style?: 'line' | 'points' | 'dashed' | 'bars' | 'outline';
}

export interface Axis {
  label: LsKey;
  vars?: LsVars;
  log?: boolean;
  /** Tick labels without a sign, for the two sides of a population pyramid. */
  absolute?: boolean;
  /** Names at positions 0, 1, 2, and so on, for bars by category. */
  categories?: readonly string[];
  min?: number;
  max?: number;
}

export interface PlotData {
  title: LsKey;
  vars?: LsVars;
  x: Axis;
  y: Axis;
  series: Series[];
}

/** A table cell: a number, text as written (a formula or a symbol), or a message such as a model's name. */
export type TableCell = number | string | { key: LsKey; vars?: LsVars };

export interface TableData {
  header: { key: LsKey; vars?: LsVars }[];
  rows: TableCell[][];
}

export interface CalcResult {
  rows: ResultRow[];
  steps: Step[];
  /** The governing equation as LaTeX, for Insert equation. */
  latex?: string;
  plots?: PlotData[];
  table?: TableData;
  /** Teaching context: usual ranges and what the model assumes. */
  notes?: Step[];
  /** Where reference values come from, shown under the result. */
  source?: LsKey;
}

export interface Choice {
  value: string;
  label: LsKey;
}

export interface FieldSpec {
  id: string;
  label: LsKey;
  /** A number (the default), a choice, a pasted table of numbers, or free text. */
  kind?: 'number' | 'select' | 'data' | 'text';
  unit?: UnitGroup;
  /** The unit shown first; the group's first unit when absent. */
  unitInitial?: string;
  options?: readonly Choice[];
  initial?: string;
  help?: LsKey;
  /** A number field that may stay empty. */
  optional?: boolean;
}

/** Reads a form's values. Numbers come back in the unit group's base unit; each method throws LsError on bad input. */
export interface Reader {
  num(id: string): number;
  /** A number, or null when the field is empty. */
  opt(id: string): number | null;
  choice(id: string): string;
  text(id: string): string;
  /** The rows of a data field, each a list of numbers; a header line is skipped. */
  rows(id: string): number[][];
  /** The rows of a data field whose first cell may be a name, such as a species or a sample. */
  table(id: string): { labels: string[]; rows: number[][] };
}

export interface CalcSpec {
  id: string;
  label: LsKey;
  intro?: LsKey;
  fields: readonly FieldSpec[] | ((choice: (id: string) => string) => readonly FieldSpec[]);
  /** A simulation that runs when Run is pressed, not on every keystroke. */
  manual?: boolean;
  solve(read: Reader): CalcResult;
}

export interface ToolSpec {
  calcs: readonly CalcSpec[];
  /** Shows the coursework-only note at the top (medical, physiological, and pharmacological tools). */
  clinical?: boolean;
}
