// What a tool is to the window: its fields, and a pure function from what was typed to rows, steps, and plots. The
// window draws the form, the units, the answer, the steps, the plots, and the Insert buttons, so a tool file is only
// its fields and a call to its engine. Text is named by key: a key such as "regime.design" is looked up in the tool's
// own strings section, so specs and engines stay free of sentences and can be tested without a page.
import { evaluate } from '../../../../core/expr';
import { AeroError } from '../common';
import type { AeroStep, XY } from '../common';
import type { AeroToolId } from '../meta';
import { defaultUnit, findUnit, fromSI, toSI } from './units';
import type { QtyKind, UnitSystem } from './units';

export type Values = Readonly<Record<string, string>>;

export interface FieldDef {
  readonly id: string;
  readonly kind: 'quantity' | 'number' | 'choice' | 'text';
  /** For a quantity: what it measures, which picks its units. */
  readonly qty?: QtyKind;
  /** The starting text; for a quantity, in the SI default unit of its kind. */
  readonly initial: string;
  /** For a choice: its values, each labeled by the key "o.<value>". */
  readonly options?: readonly string[];
  /** Shown only when this returns true for the other fields' values. */
  readonly when?: (values: Values) => boolean;
  /** Left blank, it means "not given" rather than a mistake. */
  readonly optional?: boolean;
  /** Spans the whole form row (long text). */
  readonly wide?: boolean;
}

/** Text named by a key in the tool's strings section, with values to fill in. */
export interface Ref {
  readonly key: string;
  readonly vars?: Readonly<Record<string, string>>;
}

export interface Row {
  /** The label's key, "r.<id>", unless `label` names it. */
  readonly id: string;
  /** The label's key when rows repeat one label with different vars, such as a value for each mode. */
  readonly label?: string;
  /** An SI value, shown in the chosen system when `qty` is given. */
  readonly value?: number;
  readonly qty?: QtyKind;
  /** A unit that has no US form, such as "per rad" or "mg/(N s)"; shown after the number as is. */
  readonly unit?: string;
  readonly sig?: number;
  /** Text shown as it is, such as a complex number. */
  readonly text?: string;
  /** A word or sentence from the strings shown as the value, such as "@layer.troposphere". */
  readonly word?: string;
  readonly vars?: Readonly<Record<string, string>>;
  /** Part of the one-line answer Insert puts on the page. */
  readonly answer?: boolean;
}

export interface PlotSeries {
  /** The legend's key, "p.<label>". */
  readonly label: string;
  readonly points: readonly XY[];
  /** Segments take the points in pairs. */
  readonly style?: 'line' | 'dashed' | 'dots' | 'segments';
}

export interface PlotSpec {
  /** The plot's title key, "p.<title>"; the axis keys likewise. */
  readonly title: string;
  readonly x: string;
  readonly y: string;
  readonly series: readonly PlotSeries[];
  readonly logX?: boolean;
  readonly logY?: boolean;
  /** One unit on x is as long as one on y (shapes and flow fields). */
  readonly equal?: boolean;
  /** y grows downward, as Cp plots are drawn. */
  readonly invertY?: boolean;
  /** Points to mark and name, such as an operating point. */
  readonly marks?: readonly { readonly x: number; readonly y: number; readonly label: string }[];
  /** A window to draw instead of fitting the data. */
  readonly window?: { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number };
}

export interface ToolOutput {
  /** A sentence that sums the answer up, such as the flow regime. */
  readonly headline?: Ref;
  readonly rows: readonly Row[];
  readonly steps: readonly AeroStep[];
  /** The key equation, for the Equation insert. */
  readonly latex?: string;
  readonly plots?: readonly PlotSpec[];
  readonly notes?: readonly Ref[];
}

/** What a tool's run reads its fields through: numbers come back in SI, and a missing number is an AeroError. */
export interface Inputs {
  readonly values: Values;
  /** A quantity in SI units. */
  q(id: string): number;
  /** A quantity in SI units, or undefined when left blank. */
  qOpt(id: string): number | undefined;
  /** A plain number. */
  n(id: string): number;
  nOpt(id: string): number | undefined;
  /** A choice's value. */
  c(id: string): string;
  /** Text as typed. */
  s(id: string): string;
}

export interface ToolSpec {
  readonly id: AeroToolId;
  readonly fields: readonly FieldDef[];
  /** Where the data and formulas come from, shown under the answer. */
  readonly sources?: readonly string[];
  run(inputs: Inputs): ToolOutput;
}

/** The key a quantity field's unit is kept under, next to its number. */
export const unitKey = (id: string): string => `${id}@unit`;

export function initialValues(spec: ToolSpec, system: UnitSystem): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of spec.fields) {
    values[field.id] = field.initial;
    if (field.kind === 'quantity' && field.qty) values[unitKey(field.id)] = defaultUnit(field.qty, 'si').sym;
  }
  return switchSystem(spec, values, system);
}

/** A number for a field: six significant figures, without a trailing run of zeros. */
export const inputText = (value: number): string => String(Number(value.toPrecision(6)));

/**
 * Moves every quantity field to the system's first unit, converting its number, so switching SI and US keeps the
 * problem the same. A field whose text is not a number keeps its unit, so its meaning does not change.
 */
export function switchSystem(spec: ToolSpec, values: Values, system: UnitSystem): Record<string, string> {
  const next: Record<string, string> = { ...values };
  for (const field of spec.fields) {
    if (field.kind !== 'quantity' || !field.qty) continue;
    const from = findUnit(field.qty, values[unitKey(field.id)]) ?? defaultUnit(field.qty, 'si');
    const to = defaultUnit(field.qty, system);
    const value = readNumber(values[field.id] ?? '');
    if (from.sym === to.sym || (value !== undefined && !Number.isFinite(value))) continue;
    if (value !== undefined) next[field.id] = inputText(fromSI(toSI(value, from), to));
    next[unitKey(field.id)] = to.sym;
  }
  return next;
}

/** Reads a number as typed: digits, a power of ten, or a short expression such as 2*pi or 1/3. */
export function readNumber(text: string): number | undefined {
  const plain = text.trim().replace(/[−–]/g, '-').replace(/\s+/g, '');
  if (plain === '') return undefined;
  const direct = Number(plain);
  if (Number.isFinite(direct)) return direct;
  const result = evaluate(plain);
  return result.ok && Number.isFinite(result.value) ? result.value : NaN;
}

export function readInputs(spec: ToolSpec, values: Values): Inputs {
  const fields = new Map(spec.fields.map((field) => [field.id, field]));
  const name = (id: string) => ({ name: `@f.${id}` });
  const raw = (id: string): number | undefined => {
    const value = readNumber(values[id] ?? '');
    if (value !== undefined && Number.isNaN(value)) throw new AeroError('notNumber', name(id));
    return value;
  };
  const required = (id: string, value: number | undefined): number => {
    if (value === undefined) throw new AeroError('notNumber', name(id));
    return value;
  };
  const si = (id: string, value: number | undefined): number | undefined => {
    const qty = fields.get(id)?.qty;
    if (value === undefined || !qty) return value;
    const unit = findUnit(qty, values[unitKey(id)]) ?? defaultUnit(qty, 'si');
    return toSI(value, unit);
  };
  return {
    values,
    q: (id) => required(id, si(id, raw(id))),
    qOpt: (id) => si(id, raw(id)),
    n: (id) => required(id, raw(id)),
    nOpt: (id) => raw(id),
    c: (id) => values[id] ?? fields.get(id)?.initial ?? '',
    s: (id) => values[id] ?? '',
  };
}

export type RunResult =
  { readonly ok: true; readonly output: ToolOutput } | { readonly ok: false; readonly error: AeroError };

/** Runs a tool, turning an input problem into a failure the window says in words. Other errors are bugs. */
export function runSpec(spec: ToolSpec, values: Values): RunResult {
  try {
    return { ok: true, output: spec.run(readInputs(spec, values)) };
  } catch (error) {
    if (error instanceof AeroError) return { ok: false, error };
    throw error;
  }
}

/** The fields shown for these values. */
export const visibleFields = (spec: ToolSpec, values: Values): readonly FieldDef[] =>
  spec.fields.filter((field) => !field.when || field.when(values));
