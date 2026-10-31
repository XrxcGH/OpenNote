// What an engine of the statistics kit gives back: worked steps, result tables, a one-line answer, and plots, all
// as message keys and numbers. The engines never write sentences, so every word reads in the interface's language.
import type { KitStep } from '../kits/types';
import type { PlotSpec } from './plot';
import type { StatInferMessages } from './strings';

export type { KitStep };

type Messages = StatInferMessages;

/** A key under kitStatInfer.step. */
export type StepKey = keyof Messages['step'];
/** A key under kitStatInfer.col: the name of a table column or row. */
export type ColKey = keyof Messages['col'];
/** A key under kitStatInfer.answer, a one-line result. */
export type AnswerKey = keyof Messages['answer'];
/** A key under kitStatInfer.err, a problem with the input. */
export type ErrorKey = keyof Messages['err'];
/** A key under kitStatInfer.axis: the name of a plot axis or a plot's title. */
export type AxisKey = keyof Messages['axis'];
/** A key under kitStatInfer.note, a remark under the results. */
export type NoteKey = keyof Messages['note'];

export type Vars = Readonly<Record<string, string>>;

/** A worked step in the kit foundation's form: a full message key under kitStatInfer.step, its values, and its math. */
export const step = (key: StepKey, math?: string, vars?: Record<string, string>): KitStep => ({
  key: `kitStatInfer.step.${key}`,
  ...(math === undefined ? {} : { math }),
  ...(vars ? { vars } : {}),
});

/** A table cell: a number the interface formats, text taken as it is (a label from the data), or a column key. */
export type Cell = number | string | { readonly key: ColKey } | null;

/** A column heading: a column key, or a label from the data such as a category name. */
export type Heading = ColKey | { readonly text: string };

/** A table row that starts with a row name from the strings. */
export const row = (key: ColKey, ...cells: Cell[]): Cell[] => [{ key }, ...cells];

export interface KitTable {
  readonly title: ColKey;
  readonly columns: readonly Heading[];
  readonly rows: readonly (readonly Cell[])[];
}

export interface Answer {
  readonly key: AnswerKey;
  readonly vars: Vars;
  /** The same result as LaTeX, for an equation in the page. */
  readonly latex: string;
}

/** Text shown as it is, such as a stem-and-leaf display, under a title. */
export interface TextBlock {
  readonly title: ColKey;
  readonly text: string;
}

export interface Note {
  readonly key: NoteKey;
  readonly vars?: Vars;
}

/** Everything a tool shows for one set of inputs. */
export interface Report {
  readonly answer: Answer;
  readonly tables: readonly KitTable[];
  readonly steps: readonly KitStep[];
  readonly plots?: readonly PlotSpec[];
  readonly blocks?: readonly TextBlock[];
  readonly notes?: readonly Note[];
}

/** A problem with what was typed: the key of a message and the values it names. */
export class KitError extends Error {
  readonly code: ErrorKey;
  readonly vars: Vars;
  constructor(code: ErrorKey, vars: Record<string, string> = {}) {
    super(code);
    this.code = code;
    this.vars = vars;
  }
}

/** Throws a KitError unless the condition holds. */
export function check(condition: boolean, code: ErrorKey, vars?: Record<string, string>): asserts condition {
  if (!condition) throw new KitError(code, vars);
}

/** A number written for steps and answers: up to `digits` significant figures, no trailing zeros. */
export function num(value: number, digits = 6): string {
  if (Number.isNaN(value)) return '—';
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '−∞';
  if (value === 0) return '0';
  const size = Math.abs(value);
  if (size >= 1e15 || size < 1e-6) {
    const [mantissa, exponent] = value.toExponential(digits - 1).split('e');
    return `${trimZeros(mantissa)}e${exponent.replace('+', '')}`.replace(/-/g, '−');
  }
  const fixed = Number(value.toPrecision(digits));
  return String(fixed).replace(/-/g, '−');
}

const trimZeros = (text: string): string => (text.includes('.') ? text.replace(/\.?0+$/, '') : text);

/** A p-value for an answer line: 4 significant figures, or "< 0.0001". */
export const pText = (p: number): string => (p < 1e-4 ? '< 0.0001' : `= ${num(p, 4)}`);

/** A number for LaTeX: the minus sign as a hyphen, and a power of 10 written out. */
export function tex(value: number, digits = 6): string {
  const text = num(value, digits).replace(/−/g, '-');
  const match = /^(-?[\d.]+)e(-?\d+)$/.exec(text);
  return match ? `${match[1]}\\times 10^{${match[2]}}` : text.replace('∞', '\\infty');
}

/** The p-value for LaTeX. */
export const pTex = (p: number): string => (p < 1e-4 ? 'p < 0.0001' : `p = ${tex(p, 4)}`);
