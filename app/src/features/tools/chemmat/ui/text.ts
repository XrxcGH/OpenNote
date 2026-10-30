// Text helpers for the kit's window: a translate function that takes any key of the kit, and the way a result row is
// shown in the chosen unit system.
import { t } from '../../../../strings/t';
import type { MessageKey } from '../../../../strings/t';
import type { Row } from '../types';
import { DIMS, convertFromBase, defaultUnit, formatNumber } from '../units';
import type { System } from '../units';

type Loose = (key: string, vars?: Record<string, string>) => string;

/** Translates a key of the kit with its variables; the keys are checked where the engines name them. */
export const tr = (key: MessageKey, vars?: Record<string, string>): string => (t as unknown as Loose)(key, vars);

export interface ShownRow {
  label: string;
  value: string;
  unit: string;
}

export function showRow(row: Row, system: System, digitsDefault = 5): ShownRow {
  const label = tr(row.key, row.keyVars);
  if (row.word) return { label, value: tr(row.word, row.wordVars), unit: '' };
  if (typeof row.value === 'string') return { label, value: row.value, unit: row.unit ?? '' };
  const digits = row.digits ?? digitsDefault;
  if (row.dim && row.dim !== 'none') {
    const unit = defaultUnit(row.dim, system);
    return { label, value: formatNumber(convertFromBase(row.value, row.dim, unit), digits), unit };
  }
  return { label, value: formatNumber(row.value, digits), unit: row.unit ?? '' };
}

export const hasUnits = (dim: string): boolean => dim in DIMS;
