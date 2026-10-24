// Turns what a person typed into the values a tool's engine takes, and says which field is wrong and why.
import { shownFields, type Field, type Result, type ToolSpec, type Values } from './spec';
import { defaultUnit, fromEngine, toEngine, hasUnit, type System } from './units';

export type FieldError = 'empty' | 'unreadable';

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/** A typed number, or an error code. Accepts a minus sign (−) and thin spaces between digits. */
export function parseNumber(text: string): number | FieldError {
  const clean = text.trim().replace(/−/g, '-').replace(/[\s_]/g, '');
  if (clean === '') return 'empty';
  if (!NUMBER.test(clean)) return 'unreadable';
  const value = Number(clean);
  return Number.isFinite(value) ? value : 'unreadable';
}

export type Texts = Readonly<Record<string, string>>;

/** The first texts of a tool's fields. */
export const firstTexts = (spec: ToolSpec): Record<string, string> =>
  Object.fromEntries(spec.fields.map((field) => [field.id, field.def]));

/** The first unit of each number field in a system. */
export const firstUnits = (spec: ToolSpec, system: System): Record<string, string> =>
  Object.fromEntries(
    spec.fields.flatMap((field) =>
      field.type === 'num' && field.dim ? [[field.id, defaultUnit(field.dim, system)]] : [],
    ),
  );

export type Read =
  | { readonly ok: true; readonly values: Values }
  | { readonly ok: false; readonly values: Values; readonly fields: ReadonlyMap<string, FieldError> };

/** The values of the shown fields, with each number converted from its unit to the engine's. */
export function readFields(spec: ToolSpec, texts: Texts, units: Texts): Read {
  const raw: Record<string, number | string> = {};
  const errors = new Map<string, FieldError>();
  const rawChoices: Record<string, number | string> = {};
  for (const field of spec.fields) if (field.type === 'choice') rawChoices[field.id] = texts[field.id] ?? field.def;
  const read = (field: Field) => {
    const text = texts[field.id] ?? field.def;
    if (field.type !== 'num') {
      raw[field.id] = text;
      return;
    }
    const parsed = parseNumber(text);
    if (typeof parsed === 'string') {
      if (parsed === 'empty' && field.optional) raw[field.id] = Number.NaN;
      else errors.set(field.id, parsed);
      return;
    }
    const unit = units[field.id];
    raw[field.id] = field.dim && unit && hasUnit(field.dim, unit) ? toEngine(field.dim, unit, parsed) : parsed;
  };
  // Choices decide which other fields show, so they are read first.
  for (const field of spec.fields) if (field.type === 'choice') read(field);
  for (const field of shownFields(spec, rawChoices)) if (field.type !== 'choice') read(field);
  return errors.size === 0 ? { ok: true, values: raw } : { ok: false, values: raw, fields: errors };
}

/** Runs a tool on typed texts. Errors that belong to a field come back by field. */
export function runTool(
  spec: ToolSpec,
  texts: Texts,
  units: Texts,
): { ok: true; result: Result } | { ok: false; fields: ReadonlyMap<string, FieldError> } {
  const read = readFields(spec, texts, units);
  if (!read.ok) return { ok: false, fields: read.fields };
  return { ok: true, result: spec.run(read.values) };
}

/** The texts after a change of system: each number keeps its size and gets the new system's first unit. */
export function convertTexts(
  spec: ToolSpec,
  texts: Texts,
  units: Texts,
  system: System,
): { texts: Record<string, string>; units: Record<string, string> } {
  const nextTexts: Record<string, string> = { ...texts };
  const nextUnits: Record<string, string> = { ...units };
  for (const field of spec.fields) {
    if (field.type !== 'num' || !field.dim) continue;
    const from = units[field.id] ?? defaultUnit(field.dim, system === 'si' ? 'us' : 'si');
    const to = defaultUnit(field.dim, system);
    nextUnits[field.id] = to;
    const parsed = parseNumber(texts[field.id] ?? field.def);
    if (typeof parsed === 'number' && from !== to && hasUnit(field.dim, from)) {
      nextTexts[field.id] = String(
        Number(fromEngine(field.dim, to, toEngine(field.dim, from, parsed)).toPrecision(15)),
      );
    }
  }
  return { texts: nextTexts, units: nextUnits };
}

/**
 * The texts and units of a tool that has never been used, in the system the kit last used. The field defaults are
 * written in SI, so in US they are converted rather than read as inches and feet.
 */
export function firstState(
  spec: ToolSpec,
  system: System,
): { texts: Record<string, string>; units: Record<string, string> } {
  const si = { texts: firstTexts(spec), units: firstUnits(spec, 'si') };
  return system === 'si' ? si : convertTexts(spec, si.texts, si.units, system);
}
