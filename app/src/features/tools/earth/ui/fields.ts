// Field builders for one tool's forms: labels come from kitEarth.<tool>.f, option labels from kitEarth.<tool>.o,
// and result row labels from kitEarth.<tool>.r, so each form file lists only ids, first values, and units.
import { t } from '../../../../strings/t';
import type { MessageKey } from '../../../../strings/t';
import type { QuantityId } from '../core/units';
import type { EarthToolId } from '../meta';
import type { Field } from './form';

export function fieldsFor(tool: EarthToolId) {
  const label = (key: string) => `kitEarth.${tool}.f.${key}` as MessageKey;
  const option = (key: string) => `kitEarth.${tool}.o.${key}` as MessageKey;
  return {
    /** A number field, with a unit picker when it has a quantity. */
    num: (id: string, initial: string, quantity?: QuantityId, unit?: string, rest: Partial<Field> = {}): Field => ({
      id,
      label: label(id),
      initial,
      ...(quantity ? { quantity } : {}),
      ...(unit ? { unit } : {}),
      ...rest,
    }),
    /** A select field whose options are labeled from the tool's option strings. */
    pick: (id: string, values: readonly string[], rest: Partial<Field> = {}): Field => ({
      id,
      label: label(id),
      kind: 'select',
      options: values.map((value) => ({ value, label: option(value) })),
      ...rest,
    }),
    /** A free-text or multi-line field. */
    text: (id: string, initial: string, kind: 'text' | 'area' = 'area', rest: Partial<Field> = {}): Field => ({
      id,
      label: label(id),
      kind,
      initial,
      ...rest,
    }),
    /** A result row label. */
    r: (key: string) => t(`kitEarth.${tool}.r.${key}` as MessageKey),
  };
}

/** Shows a field only when the select `id` holds one of `values`. */
export const when =
  (id: string, ...values: string[]) =>
  (text: (field: string) => string): boolean =>
    values.includes(text(id));
