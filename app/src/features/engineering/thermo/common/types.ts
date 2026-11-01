// The shapes every thermodynamics engine returns: worked steps, result rows with their kind of quantity, plots,
// and errors in words a student can act on. Engines are pure: no DOM, no React, and no t(); the window turns the
// keys into sentences.
import '../text';
import type { kitThermo } from '../../../../strings/en/kitThermo';
import type { DottedKeys } from '../../../../strings/t';
import type { Qty, System } from './units';

/** A worked-step sentence in strings/en/kitThermo.ts under step. */
export type ThermoStepKey = DottedKeys<(typeof kitThermo)['step']>;
/** A result name in strings/en/kitThermo.ts under row. */
export type ThermoRowKey = keyof (typeof kitThermo)['row'];
/** An error sentence in strings/en/kitThermo.ts under error. */
export type ThermoErrorCode = keyof (typeof kitThermo)['error'];
/** An assumption or note in strings/en/kitThermo.ts under note. */
export type ThermoNoteKey = keyof (typeof kitThermo)['note'];
/** A word that stands in for a number, such as a phase name, in strings/en/kitThermo.ts under word. */
export type ThermoWordKey = keyof (typeof kitThermo)['word'];
/** A unit to show instead of the system's first unit, such as °C for steam. */
export type PreferredUnit = Partial<Record<System, string>>;
/** A plot title in strings/en/kitThermo.ts under plot. */
export type ThermoPlotKey = keyof (typeof kitThermo)['plot'];

/** One line of worked steps: a sentence with its numbers, and the math it uses in LaTeX. */
export interface KitStep {
  key: ThermoStepKey;
  vars?: Record<string, string>;
  math?: string;
}

/** One result: its name, its symbol in LaTeX, the value in the engine's SI units, and what kind of quantity it is. */
export interface ResultRow {
  key: ThermoRowKey;
  symbol: string;
  value: number;
  qty: Qty;
  /** Words that stand in for a number, such as a phase name; the value is then ignored. */
  text?: string;
  word?: ThermoWordKey;
  unit?: PreferredUnit;
  /** Extra words after the name, such as the state number. */
  tag?: string;
  /** One of the results the Insert menu's answer line gives (the first three rows when none is). */
  answer?: boolean;
}

/** The rows with the given keys marked as the answer. */
export const markAnswer = (rows: readonly ResultRow[], keys: readonly ResultRow['key'][]): ResultRow[] =>
  rows.map((row) => (keys.includes(row.key) ? { ...row, answer: true } : row));

export interface PlotSeries {
  /** The legend text when it is a symbol, such as φ = 40 %; a word key takes its place in sentences. */
  name: string;
  word?: ThermoWordKey;
  points: readonly (readonly [number, number])[];
  dashed?: boolean;
  /** Label the line at its end instead of in the legend. */
  inline?: boolean;
}

export interface PlotMark {
  x: number;
  y: number;
  label: string;
}

/** A small line chart: axes with their quantity kinds, a few series, and marked points. */
export interface PlotSpec {
  title: ThermoPlotKey;
  x: { label: string; qty: Qty; log?: boolean; unit?: PreferredUnit };
  y: { label: string; qty: Qty; log?: boolean; unit?: PreferredUnit };
  series: readonly PlotSeries[];
  marks?: readonly PlotMark[];
}

export interface ThermoResult {
  rows: readonly ResultRow[];
  steps: readonly KitStep[];
  /** The headline equation in LaTeX, for the Insert menu. */
  latex: string;
  notes: readonly ThermoNoteKey[];
  plots?: readonly PlotSpec[];
  /** The published formulation the numbers come from, shown as Source: ... */
  source?: string;
  /** Rows of a state table (cycles), each a list of results. */
  states?: readonly StateRow[];
}

/** One state of a cycle table. */
export interface StateRow {
  label: string;
  T: number;
  p: number;
  h: number;
  s: number;
  x: number | null;
  v?: number;
}

/** A problem with the input, in words from strings/en/kitThermo.ts under error. */
export class ThermoError extends Error {
  constructor(
    readonly code: ThermoErrorCode,
    readonly vars: Record<string, string> = {},
  ) {
    super(code);
    this.name = 'ThermoError';
  }
}

/** Throws a ThermoError unless the value is a finite number. */
export function need(value: number | null | undefined, name: string): number {
  if (value === null || value === undefined || !Number.isFinite(value)) throw new ThermoError('missing', { name });
  return value;
}

/** Throws unless the value is finite and above zero. */
export function positive(value: number | null | undefined, name: string): number {
  const x = need(value, name);
  if (x <= 0) throw new ThermoError('notPositive', { name });
  return x;
}
