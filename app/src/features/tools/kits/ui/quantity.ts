// A number typed with a unit, read into SI. Plain numbers (2.5, -1e-3, 1 000) are read directly; anything else goes
// through core/expr (pi/2, 2*sqrt(3)), which evaluates math only and never runs typed text as code.
import { evaluate } from '../../../../core/expr';
import type { QuantityKind, UnitChoice, UnitSystem } from '../units';
import { findUnit, formatValue, fromSI, toSI, unitChoices } from '../units';

/** What a quantity field keeps: the text as typed and the unit's label. */
export interface QuantityInput {
  text: string;
  unit: string;
}

/** Limits in SI base units. */
export interface QuantityRules {
  positive?: boolean;
  min?: number;
  max?: number;
}

export type QuantityRead =
  { ok: true; si: number; unit: UnitChoice } | { ok: false; key: string; vars?: Readonly<Record<string, string>> };

const PLAIN = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;
const SPACES = /[\s\u00a0\u202f]/g;

/** The number in the text, or NaN when it is not one. */
export function readNumber(text: string): number {
  const cleaned = text.trim().replace(/[−–]/g, '-').replace(SPACES, '');
  if (cleaned === '') return NaN;
  if (PLAIN.test(cleaned)) return Number(cleaned);
  const result = evaluate(cleaned);
  return result.ok && Number.isFinite(result.value) ? result.value : NaN;
}

/** The unit for a label, falling back to the kind's first SI unit for a label that is not one of its units. */
export function unitFor(kind: QuantityKind, label: string): UnitChoice {
  return findUnit(kind, label) ?? unitChoices(kind, 'SI')[0];
}

/** Reads a field into SI, or says (as a kits message key) what is wrong with it. */
export function readQuantity(input: QuantityInput, kind: QuantityKind, rules: QuantityRules = {}): QuantityRead {
  if (input.text.trim() === '') return { ok: false, key: 'kits.field.required' };
  const value = readNumber(input.text);
  if (!Number.isFinite(value)) return { ok: false, key: 'kits.field.notNumber' };
  const unit = unitFor(kind, input.unit);
  const si = toSI(value, unit);
  const shown = (limit: number) => `${formatValue(fromSI(limit, unit))}${unit.label ? ` ${unit.label}` : ''}`;
  if (rules.positive && !(si > 0)) return { ok: false, key: 'kits.field.positive' };
  if (rules.min !== undefined && si < rules.min) {
    return { ok: false, key: 'kits.field.atLeast', vars: { min: shown(rules.min) } };
  }
  if (rules.max !== undefined && si > rules.max) {
    return { ok: false, key: 'kits.field.atMost', vars: { max: shown(rules.max) } };
  }
  return { ok: true, si, unit };
}

/** A field's starting value: a number in a unit. */
export const quantity = (value: number | string, unit: string): QuantityInput => ({ text: String(value), unit });

/**
 * The field in `system`: unchanged when its unit belongs there, otherwise converted to the system's first unit with
 * six significant digits (text that is not a number keeps its text). Tools call it when the person switches systems.
 */
export function inSystem(input: QuantityInput, kind: QuantityKind, system: UnitSystem): QuantityInput {
  const list = unitChoices(kind, system);
  if (list.some((unit) => unit.label === input.unit)) return input;
  const value = readNumber(input.text);
  const target = list[0];
  if (!Number.isFinite(value)) return { text: input.text, unit: target.label };
  const si = toSI(value, unitFor(kind, input.unit));
  return { text: String(Number(fromSI(si, target).toPrecision(6))), unit: target.label };
}

/** A result in the first unit of `system` (or a named unit of the kind), as value text and unit label. */
export function showQuantity(
  si: number,
  kind: QuantityKind,
  system: UnitSystem,
  digits = 4,
  unitLabel?: string,
): { value: string; unit: string } {
  const unit = (unitLabel !== undefined ? findUnit(kind, unitLabel) : null) ?? unitChoices(kind, system)[0];
  return { value: formatValue(fromSI(si, unit), digits), unit: unit.label };
}
