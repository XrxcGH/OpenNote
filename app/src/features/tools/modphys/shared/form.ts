// The parts of a calculator form that are not drawing: field descriptions, typed values, reading a field as a
// number in SI, and the outcome a form shows. Numbers may be typed as 1e18, 1.2×10^5, 1,000 or with a minus sign.
import { need } from './errors';
import type { PlotSpec } from './plot';
import { toSI, unitIds } from './units';
import type { Dimension } from './units';

export interface FieldSpec {
  id: string;
  label: string;
  /** A number (the default), one line of text, several lines of text, or a choice. */
  kind?: 'number' | 'text' | 'lines' | 'select';
  /** Shows a unit picker for this dimension; the value is read in SI. */
  dimension?: Dimension;
  /** The units offered, when not all the dimension's. */
  units?: readonly string[];
  initial?: string;
  initialUnit?: string;
  options?: readonly { value: string; label: string }[];
  wide?: boolean;
  help?: string;
}

export interface Values {
  text: Record<string, string>;
  unit: Record<string, string>;
}

export interface Row {
  label: string;
  value: string;
}

export interface StepLine {
  label: string;
  text: string;
  tex?: string;
}

export type Outcome =
  | {
      ok: true;
      answer: string;
      latex?: string;
      rows?: readonly Row[];
      steps?: readonly StepLine[];
      plot?: PlotSpec;
      notes?: readonly string[];
    }
  | { ok: false; message: string };

export const unitsOf = (field: FieldSpec): readonly string[] =>
  field.units ?? (field.dimension ? unitIds(field.dimension) : []);

/** A typed number: null when empty, NaN when it is not a number. */
export function parseNumber(raw: string): number | null {
  const text = raw
    .trim()
    .replace(/[−–]/g, '-')
    .replace(/,/g, '')
    .replace(/\s*[×x*]\s*10\s*\^?\s*/i, 'e')
    .replace(/\s+/g, '');
  if (text === '') return null;
  return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(text) ? Number(text) : NaN;
}

/** The number in a field; throws when it is empty or not a number. */
export function value(values: Values, id: string, quantity: string): number {
  const n = parseNumber(values.text[id] ?? '');
  if (n === null) need('empty', quantity);
  if (Number.isNaN(n)) need('notNumber', quantity);
  return n;
}

/** The number in a field, or a fallback when the field is empty. */
export function optional(values: Values, id: string, quantity: string, fallback: number): number {
  const n = parseNumber(values.text[id] ?? '');
  if (n === null) return fallback;
  if (Number.isNaN(n)) need('notNumber', quantity);
  return n;
}

/** The number in a field with a unit picker, in SI. */
export function si(values: Values, id: string, dimension: Dimension, quantity: string): number {
  const unit = values.unit[id] ?? unitIds(dimension)[0]!;
  return toSI(value(values, id, quantity), dimension, unit);
}

/** The text of a field, trimmed. */
export const textOf = (values: Values, id: string): string => (values.text[id] ?? '').trim();
