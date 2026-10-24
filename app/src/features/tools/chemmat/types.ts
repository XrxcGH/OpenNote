// The shapes the chemistry and materials tools share: worked steps, result rows, plots, and the answer of a solve.
// Engines return these as plain data, so they need no DOM and no translation function; the window turns the keys
// into words.
import type { MessageKey } from '../../../strings/t';

/** One line of working: a message from this kit's strings, its values, and an optional equation in LaTeX. */
export interface KitStep {
  key: MessageKey;
  vars?: Record<string, string>;
  math?: string;
}

/** The kind of quantity a row holds, so the window can show it in the unit system the student chose. */
export type Dim =
  | 'energyMol'
  | 'entropyMol'
  | 'temperature'
  | 'pressure'
  | 'concentration'
  | 'massConcentration'
  | 'time'
  | 'length'
  | 'distance'
  | 'mass'
  | 'volume'
  | 'diffusivity'
  | 'stress'
  | 'frequency'
  | 'photonEnergy'
  | 'energy'
  | 'none';

export interface Row {
  key: MessageKey;
  /** Variables for the key, such as a species name. */
  keyVars?: Record<string, string>;
  /** A number in SI units for its dimension, or text that is not translated (a formula, a Miller index). */
  value: number | string;
  /** A message that replaces the value when the answer is words (a shape, or spontaneous or not). */
  word?: MessageKey;
  /** Variables for the word. */
  wordVars?: Record<string, string>;
  dim?: Dim;
  /** A fixed unit shown after the value when the dimension does not name it, such as "mol/L". */
  unit?: string;
  /** Significant figures to show; the window's default is 5. */
  digits?: number;
}

export interface Series {
  label: MessageKey;
  labelVars?: Record<string, string>;
  points: readonly (readonly [number, number])[];
  /** Points are joined by a line (the default) or drawn as dots. */
  style?: 'line' | 'dots';
}

export interface PlotData {
  xLabel: MessageKey;
  yLabel: MessageKey;
  series: readonly Series[];
  logX?: boolean;
  logY?: boolean;
  /** The message that describes the picture for a screen reader and for the page's alternative text. */
  alt: MessageKey;
}

export interface Solved {
  ok: true;
  rows: Row[];
  steps: KitStep[];
  /** The assumptions this answer rests on, as messages. */
  notes: { key: MessageKey; vars?: Record<string, string> }[];
  /** The main equation of the answer, for Insert as equation. */
  equation?: string;
  plot?: PlotData;
  /** Extra tables (an ICE table, a species table): header cells (a message key of the kit, or plain text) and rows of text. */
  tables?: { title: MessageKey; header: string[]; rows: string[][] }[];
  /** Where the data came from, shown under the answer. */
  sources?: string[];
}

export interface Failed {
  ok: false;
  /** A message from this kit's strings that says what is wrong with the input. */
  key: MessageKey;
  vars?: Record<string, string>;
}

export type Outcome = Solved | Failed;

export const fail = (key: MessageKey, vars?: Record<string, string>): Failed => ({ ok: false, key, vars });
