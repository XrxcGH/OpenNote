// What the molecular biology tools share: the shape of an answer, input problems named by message key, and number
// reading and showing. Everything here is pure; the interface text lives in strings/en/kitMolBio.ts and is looked up
// by key, so an engine names a message and never builds a sentence.
import { formatNumber } from '../../../core/expr';
import type { DottedKeys } from '../../../strings/t';
import type { kitMolBio } from '../../../strings/en/kitMolBio';
import type { Figure } from './figure';

/** A message in the kit's namespace, such as 'sequence.r.length' or 'e.number'. */
export type MolKey = DottedKeys<typeof kitMolBio>;
export type Vars = Record<string, string>;

export interface KitStep {
  key: MolKey;
  vars?: Vars;
  /** LaTeX for the step's equation, copied with the step. */
  math?: string;
}

export interface KitRow {
  key: MolKey;
  value: string;
  /** A word shown instead of `value`, such as "Missense". */
  word?: MolKey;
  vars?: Vars;
}

/** A table cell: text such as a number or a sequence, or a word from the strings. */
export type Cell = string | { word: MolKey; vars?: Vars };

export interface KitTable {
  title: MolKey;
  vars?: Vars;
  head: MolKey[];
  rows: Cell[][];
}

/** A monospace block, such as a numbered sequence, an alignment, or a Newick string. */
export interface KitBlock {
  title: MolKey;
  text: string;
}

export interface KitFigure {
  title: MolKey;
  vars?: Vars;
  figure: Figure;
}

export interface KitOk {
  ok: true;
  /** The one-line answer inserted into the page. */
  answer: { key: MolKey; vars?: Vars };
  rows: KitRow[];
  steps: KitStep[];
  tables?: KitTable[];
  blocks?: KitBlock[];
  figures?: KitFigure[];
  latex?: string;
  notes: MolKey[];
  source?: MolKey;
}

export interface KitFail {
  ok: false;
  error: MolKey;
  vars?: Vars;
}

export type KitResult = KitOk | KitFail;

/** A problem with an input, named by message key so the interface says it in words. */
export class KitError extends Error {
  constructor(
    readonly key: MolKey,
    readonly vars: Vars = {},
  ) {
    super(key);
  }
}

export const fail = (key: MolKey, vars?: Vars): never => {
  throw new KitError(key, vars);
};

export const ok = (result: Omit<KitOk, 'ok' | 'notes' | 'steps'> & { notes?: MolKey[]; steps?: KitStep[] }): KitOk => ({
  ok: true,
  notes: [],
  steps: [],
  ...result,
});

// ---- Numbers ----

/** A number to `digits` significant figures, with a true minus sign. */
export function fmt(value: number, digits = 6): string {
  if (Number.isNaN(value)) return '—';
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '−∞';
  if (value === 0 || Math.abs(value) < 1e-15) return '0';
  return formatNumber(value, { digits }).replace(/^-/, '−');
}

/** A fraction as a percentage, such as 41.667%. */
export const pct = (fraction: number, digits = 5): string => `${fmt(fraction * 100, digits)}%`;

/** Reads a plain number the way a student types it: 0.25, -3, 1e-5, 1,000 or with a true minus sign. */
export function readNumber(text: string): number | null {
  const cleaned = text.trim().replace(/−/g, '-').replace(/,/g, '').replace(/\s+/g, '');
  if (cleaned === '' || !/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export type Values = Record<string, string>;

/** A required number from the form; throws a message naming the field when it is not one. */
export function need(values: Values, id: string, label: MolKey): number {
  const value = readNumber(values[id] ?? '');
  return value === null ? fail('e.number', { field: label }) : value;
}

/** need(), and the number must be above zero. */
export function positive(values: Values, id: string, label: MolKey): number {
  const value = need(values, id, label);
  return value > 0 ? value : fail('e.positive', { field: label });
}

/** need(), and the number must be a whole number from `min` to `max`. */
export function whole(values: Values, id: string, label: MolKey, range: [number, number]): number {
  const value = need(values, id, label);
  const [min, max] = range;
  if (!Number.isInteger(value) || value < min || value > max) {
    return fail('e.wholeRange', { field: label, min: String(min), max: String(max) });
  }
  return value;
}

/** need(), and the number must lie from `min` to `max`. */
export function within(values: Values, id: string, label: MolKey, range: [number, number]): number {
  const value = need(values, id, label);
  const [min, max] = range;
  return value >= min && value <= max ? value : fail('e.range', { field: label, min: fmt(min), max: fmt(max) });
}

/** Numbers separated by commas, spaces, or line breaks; throws when one cannot be read. */
export function numberList(text: string, label: MolKey): number[] {
  const parts = text
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
  return parts.map((part) => readNumber(part) ?? fail('e.listNumber', { field: label, text: part }));
}

/** The lines of a text box with their blank lines and surrounding spaces removed. */
export const lines = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));

/** Escapes text for SVG and HTML. */
export const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
