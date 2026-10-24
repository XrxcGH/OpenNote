// A tool form's state and its values: the typed text and unit of each field, read as numbers in the engine's
// units, and kept in step when the unit system changes. Pure, so the window and the tests share it.
import { evaluate } from '../../../../core/expr';
import { fmt } from '../common/format';
import type { FieldSpec, ModeSpec, Values } from '../common/spec';
import { UNITS, defaultUnit, fromEngine, toEngine, type System } from '../common/units';
import type { SavedForm } from './store';

/** A typed number, which may be simple math such as 2*pi or 1e5. NaN when it is not a number, null when empty. */
export function readNumber(text: string): number | null {
  const trimmed = text.trim().replace(/,/g, '');
  if (trimmed === '') return null;
  if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(trimmed)) return Number(trimmed);
  const result = evaluate(trimmed.replace(/×/g, '*').replace(/−/g, '-'));
  return result.ok && Number.isFinite(result.value) ? result.value : NaN;
}

export const unitOf = (form: SavedForm, field: FieldSpec, system: System): string =>
  form.unit[field.id] ?? defaultUnit(field.qty ?? 'none', system, field.unit);

/** The text a field shows: what was typed, or its first value in the field's unit. */
export function textOf(form: SavedForm, field: FieldSpec, system: System): string {
  const typed = form.text[field.id];
  // A choice saved under another mode or process may not be offered now; the field's first value stands in.
  if (field.kind === 'choice' && typed !== undefined && !field.options?.some((one) => one.value === typed))
    return String(field.initial ?? field.options?.[0]?.value ?? '');
  if (typed !== undefined) return typed;
  if (field.initial === null) return '';
  if (typeof field.initial === 'string') return field.initial;
  return fmt(fromEngine(field.initial, field.qty ?? 'none', unitOf(form, field, system)), 6);
}

/** The fields a mode shows, worked out from the choices made so far. */
export function fieldsOf(mode: ModeSpec, form: SavedForm, system: System): readonly FieldSpec[] {
  let fields = mode.fields({});
  // Choices decide which fields appear, so read them, then ask again (twice covers a choice behind a choice).
  for (let pass = 0; pass < 2; pass++) fields = mode.fields(valuesOf(fields, form, system).values);
  return fields;
}

/** The values in engine units, and the ids of fields whose text is not a number. */
export function valuesOf(
  fields: readonly FieldSpec[],
  form: SavedForm,
  system: System,
): { values: Values; invalid: string[]; empty: string[] } {
  const values: Record<string, number | string | null> = {};
  const invalid: string[] = [];
  const empty: string[] = [];
  for (const field of fields) {
    const text = textOf(form, field, system);
    if (field.kind === 'choice' || field.kind === 'list') {
      values[field.id] = text;
      if (field.kind === 'list' && text.split(/[,;\s]+/).some((part) => part !== '' && !Number.isFinite(Number(part))))
        invalid.push(field.id);
      continue;
    }
    const number = readNumber(text);
    if (number === null) {
      values[field.id] = null;
      if (!field.optional) empty.push(field.id);
    } else if (Number.isNaN(number)) {
      values[field.id] = null;
      invalid.push(field.id);
    } else values[field.id] = toEngine(number, field.qty ?? 'none', unitOf(form, field, system));
  }
  return { values, invalid, empty };
}

/** The form after a change of unit system: typed numbers move to the new system's units and keep their value. */
export function switchSystem(form: SavedForm, fields: readonly FieldSpec[], from: System, to: System): SavedForm {
  const text = { ...form.text };
  const unit = { ...form.unit };
  for (const field of fields) {
    if (field.kind === 'choice' || field.kind === 'list' || !field.qty) continue;
    const current = unitOf(form, field, from);
    if (UNITS[field.qty][to].some((one) => one.id === current)) continue;
    const next = defaultUnit(field.qty, to, field.unit);
    const typed = form.text[field.id];
    const number = typed === undefined ? null : readNumber(typed);
    if (typed !== undefined && number !== null && Number.isFinite(number))
      text[field.id] = fmt(fromEngine(toEngine(number, field.qty, current), field.qty, next), 6);
    unit[field.id] = next;
  }
  return { ...form, text, unit };
}
