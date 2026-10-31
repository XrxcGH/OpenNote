// The earth kit's calculations as data: each mode lists its fields and a solve function from a Reader to an
// outcome. The Reader turns typed text into SI numbers and names the field when something is missing, so every
// tool reports empty or impossible input the same calm way.
import { t } from '../../../../strings/t';
import type { MessageKey } from '../../../../strings/t';
import { readNumber } from '../core/format';
import type { Figure } from '../core/figure';
import { Problem } from '../core/problem';
import { toSI, unitIds } from '../core/units';
import type { QuantityId } from '../core/units';
import type { EarthToolId } from '../meta';

export interface Option {
  value: string;
  label: MessageKey;
}

export interface Field {
  id: string;
  label: MessageKey;
  kind?: 'number' | 'select' | 'text' | 'area';
  quantity?: QuantityId;
  /** The unit the field starts in; the quantity's first unit when left out. */
  unit?: string;
  options?: readonly Option[];
  initial?: string;
  help?: MessageKey;
  optional?: boolean;
  /** Shown only when this holds for what is typed so far. */
  show?: (text: (id: string) => string) => boolean;
  rows?: number;
}

export interface Values {
  text: Record<string, string>;
  unit: Record<string, string>;
}

export interface Outcome {
  answer: string;
  latex?: string;
  rows?: readonly (readonly [string, string])[];
  table?: { header: string[]; rows: string[][] };
  steps?: readonly string[];
  figures?: readonly Figure[];
  source?: string;
  note?: string;
}

export type Result = { ok: true; outcome: Outcome } | { ok: false; message: string };

export interface Mode {
  id: string;
  label: MessageKey;
  intro?: MessageKey;
  fields: readonly Field[];
  solve(read: Reader): Outcome;
}

/** A field that cannot be read: its label and what is wrong with it. */
class InputProblem extends Error {
  constructor(
    readonly key: 'kitEarth.fill' | 'kitEarth.notNumber',
    readonly name: string,
  ) {
    super(key);
  }
}

export class Reader {
  constructor(
    private readonly fields: readonly Field[],
    private readonly values: Values,
  ) {}

  private field(id: string): Field {
    const field = this.fields.find((f) => f.id === id);
    if (!field) throw new Error(`No field ${id}`);
    return field;
  }

  label(id: string): string {
    return t(this.field(id).label);
  }

  raw(id: string): string {
    return (this.values.text[id] ?? this.field(id).initial ?? '').trim();
  }

  unit(id: string): string {
    const field = this.field(id);
    return this.values.unit[id] ?? field.unit ?? '';
  }

  /** The value in SI, or null when the field is empty. */
  opt(id: string): number | null {
    const field = this.field(id);
    const value = readNumber(this.raw(id));
    if (value === null) return null;
    if (Number.isNaN(value)) throw new InputProblem('kitEarth.notNumber', t(field.label));
    return field.quantity ? toSI(value, field.quantity, this.unit(id)) : value;
  }

  /** The value in SI; a message names the field when it is empty or not a number. */
  num(id: string): number {
    const value = this.opt(id);
    if (value === null) throw new InputProblem('kitEarth.fill', t(this.field(id).label));
    return value;
  }

  /** The chosen option of a select field. */
  pick(id: string): string {
    const field = this.field(id);
    const value = this.raw(id);
    return field.options?.some((o) => o.value === value) ? value : (field.options?.[0]?.value ?? value);
  }
}

/** The first values of a mode's fields. */
export function initialValues(mode: Mode): Values {
  return {
    text: Object.fromEntries(
      mode.fields.map((f) => [f.id, f.initial ?? (f.kind === 'select' ? f.options![0].value : '')]),
    ),
    unit: Object.fromEntries(
      mode.fields.filter((f) => f.quantity).map((f) => [f.id, f.unit ?? unitIds(f.quantity!)[0]]),
    ),
  };
}

/** t() for a key built at run time; it throws, as t() does, when the key has no message. */
export const looseT = t as unknown as (key: string, values?: Readonly<Record<string, string | number>>) => string;

/** The words for an engine's problem in a tool's strings, or a general message when the tool has none for it. */
export function problemText(tool: EarthToolId, problem: Problem): string {
  for (const key of [`kitEarth.${tool}.errors.${problem.code}`, `kitEarth.errors.${problem.code}`]) {
    try {
      return looseT(key, problem.vars);
    } catch {
      // Try the next place the message may be.
    }
  }
  return t('kitEarth.cannot');
}

export function run(tool: EarthToolId, mode: Mode, values: Values): Result {
  try {
    return { ok: true, outcome: mode.solve(new Reader(mode.fields, values)) };
  } catch (error) {
    if (error instanceof InputProblem) {
      const vars = { name: error.name };
      return {
        ok: false,
        message: error.key === 'kitEarth.fill' ? t('kitEarth.fill', vars) : t('kitEarth.notNumber', vars),
      };
    }
    if (error instanceof Problem) return { ok: false, message: problemText(tool, error) };
    throw error;
  }
}
