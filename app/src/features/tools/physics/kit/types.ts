// The shapes the physics tools share. An engine is pure: it takes numbers in SI units and returns numbers, worked
// steps and plot data, never text in a language. Steps and labels name a message key in the kitPhysics namespace and
// the values to fill it with, so the window can say them and a test can check them. The shapes follow the tool-kit
// contract (KitStep, KitToolProps, KitInsert), so the tools move into a shared kit window without changes.
import '../text';
import type { MessageKey } from '../../../../strings/t';
import type { Reader } from './read';
import type { DimId } from './units';

/** One line of worked steps: a message and the values that fill it. `labels` are values that are message keys. */
export interface KitStep {
  key: MessageKey;
  vars?: Record<string, string>;
  labels?: Record<string, MessageKey>;
  /** LaTeX for the line's equation, when it has one. */
  math?: string;
}

/** One result: its name, a symbol, and its value in SI units with the dimension that picks its display unit. */
export interface ResultRow {
  key: MessageKey;
  symbol?: string;
  value: number | string;
  dim?: DimId;
  /** The unit to show in SI, such as 'mm' for a fringe spacing; the dimension's own SI unit otherwise. */
  unit?: string;
  /** The unit to show in US customary units, when the dimension's own US unit does not suit. */
  usUnit?: string;
  /** A result that is a word, such as 'Fully constructive': the message to show instead of `value`. */
  word?: MessageKey;
  /** A result that the answer line repeats. */
  primary?: boolean;
  digits?: number;
}

export type Tone = 'ink' | 'muted' | 'accent' | 'second' | 'third' | 'danger';

export interface PlotSeries {
  points: readonly (readonly [number, number])[];
  tone?: Tone;
  dash?: boolean;
  width?: number;
  /** Fills the closed shape the points make, lightly. */
  fill?: boolean;
}

export interface PlotCircle {
  x: number;
  y: number;
  /** Radius in data units, or in pixels when `px` is set. */
  r: number;
  px?: boolean;
  tone?: Tone;
  fill?: boolean;
}

export interface PlotLabel {
  x: number;
  y: number;
  text: string;
  tone?: Tone;
  anchor?: 'start' | 'middle' | 'end';
}

export interface PlotArrow {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  tone?: Tone;
}

export interface PlotAxis {
  label: string;
  min?: number;
  max?: number;
}

/** A picture of a result: an x-y plot with axes, or a sketch with equal scales and no axes. */
export interface Plot {
  frame: 'axes' | 'equal' | 'sketch';
  alt: KitStep;
  x: PlotAxis;
  y: PlotAxis;
  series: readonly PlotSeries[];
  circles?: readonly PlotCircle[];
  labels?: readonly PlotLabel[];
  arrows?: readonly PlotArrow[];
  /** A legend, one entry per tone. */
  legend?: readonly { tone: Tone; key: MessageKey; dash?: boolean }[];
}

export type Outcome =
  | {
      ok: true;
      rows: readonly ResultRow[];
      steps: readonly KitStep[];
      latex?: string;
      plot?: Plot;
      /** Assumptions and checks, said under the result. */
      notes?: readonly KitStep[];
      /** Where tabulated data came from. */
      source?: MessageKey;
    }
  | { ok: false; problem: KitStep };

export type FieldKind = 'number' | 'choice' | 'vector' | 'rows';

export interface FieldColumn {
  label: MessageKey;
  dim?: DimId;
  unit?: string;
}

export interface FieldDef {
  id: string;
  label: MessageKey;
  kind?: FieldKind;
  dim?: DimId;
  /** The unit the field starts in for SI and for US customary units. */
  unit?: string;
  usUnit?: string;
  initial: string;
  options?: readonly { value: string; label: MessageKey }[];
  optional?: boolean;
  help?: MessageKey;
  /** For rows: what each number on a line means. */
  columns?: readonly FieldColumn[];
  /** Shown only when this returns true for the current choices. */
  when?(choice: (id: string) => string): boolean;
}

export interface ModeDef {
  id: string;
  label: MessageKey;
  fields: readonly FieldDef[];
  intro?: MessageKey;
  solve(read: Reader): Outcome;
}

export interface ToolSpec {
  id: string;
  modes: readonly ModeDef[];
}

export type UnitSystem = 'SI' | 'US';

/** What a tool keeps between visits: the mode, and each field's text and unit. */
export interface ToolInputs {
  mode: string;
  text: Record<string, string>;
  unit: Record<string, string>;
}

/** The insert actions a tool offers, each writing at the caret of the open page. */
export interface KitInsert {
  answer(text: string): boolean;
  equation(latex: string, display: boolean): boolean;
  table(header: string[], rows: string[][]): boolean;
  steps(lines: readonly string[]): boolean;
  picture(svg: string, alt: string): boolean | Promise<boolean>;
}

export interface KitToolProps {
  inputs: unknown;
  setInputs(next: unknown): void;
  system: UnitSystem;
  insert: KitInsert;
}
