// What every economics and finance form shares: words from the kitEcon strings, the answer shapes the chemistry
// form already renders (a headline, steps, and an optional picture), and a reader for the numbers a form asks for.
import type { ReactNode } from 'react';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { num } from '../ui/ChemForm';
import type { ChemFormProps, FieldSpec, Outcome, Values } from '../ui/ChemForm';

export type { FieldSpec, Outcome, Values };

/** One form of a tool: the id names it in the picker; the rest is what the shared form needs. */
export interface EconForm extends Omit<ChemFormProps, 'intro'> {
  id: string;
  /** True when the form reads an empty field as a value the form solves for. */
  intro?: boolean;
}

export interface EconToolDef {
  id: string;
  forms: readonly EconForm[];
}

/** The text at kitEcon.<key>, with parameters. */
export function tx(key: string, params?: Record<string, string | number>): string {
  return (t as (key: MessageKey, params?: unknown) => string)(`kitEcon.${key}` as MessageKey, params);
}

export const ok = (headline: string, steps: readonly string[] = [], figure?: ReactNode): Outcome => ({
  ok: true,
  headline,
  steps,
  figure,
});

export const bad = (key: string, params?: Record<string, string | number>): Outcome => ({
  ok: false,
  message: tx(key, params),
});

/** A field whose label is kitEcon.<tool>.f.<id>. */
export const field = (tool: string, id: string, rest: Partial<FieldSpec> = {}): FieldSpec => ({
  id,
  label: tx(`${tool}.f.${id}`),
  ...rest,
});

/** A select field whose option labels are kitEcon.<tool>.o.<option>. */
export const choice = (tool: string, id: string, options: readonly string[], initial?: string): FieldSpec => ({
  id,
  label: tx(`${tool}.f.${id}`),
  kind: 'select',
  options: options.map((value) => ({ value, label: tx(`${tool}.o.${value}`) })),
  initial: initial ?? options[0],
});

export const text = (values: Values, id: string): string => (values.text[id] ?? '').trim();

/** The numbers of the named fields, or the answer that says which one is missing or not a number. */
export function read(tool: string, values: Values, ids: readonly string[]): number[] | Outcome {
  const out: number[] = [];
  for (const id of ids) {
    const x = num(values, id);
    const name = tx(`${tool}.f.${id}`);
    if (x === null) return bad('common.missing', { name });
    if (Number.isNaN(x)) return bad('common.notNumber', { name });
    out.push(x);
  }
  return out;
}

export const failed = (x: number[] | Outcome): x is Outcome => !Array.isArray(x);

/** The number of an optional field: null when empty, NaN when it is not a number. */
export const optional = (values: Values, id: string): number | null => num(values, id);
