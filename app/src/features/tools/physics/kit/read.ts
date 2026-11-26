// Reads a tool's typed fields into SI numbers, and runs a mode's solver. A field that is empty, not a number, or out
// of range stops the solve with a message that names the field, so the window can say what to fix. Engines stop the
// same way, with fail(), when the numbers describe something impossible (a speed at or above c, a mass that does not
// fit, total internal reflection).
import '../text';
import type { MessageKey } from '../../../../strings/t';
import type { FieldDef, KitStep, ModeDef, Outcome, ToolInputs, ToolSpec, UnitSystem } from './types';
import { defaultUnit, toSI, unitOf } from './units';

export class FieldProblem extends Error {
  constructor(readonly step: KitStep) {
    super(step.key);
  }
}

/** Stops a solve with a message for the person. */
export function fail(key: MessageKey, vars?: Record<string, string>, labels?: Record<string, MessageKey>): never {
  throw new FieldProblem({ key, ...(vars ? { vars } : {}), ...(labels ? { labels } : {}) });
}

export type Check = 'any' | 'positive' | 'nonNegative' | { min?: number; max?: number; above?: number };

export interface Reader {
  /** A required number in SI units. */
  num(id: string, check?: Check): number;
  /** An optional number in SI units, or null when the field is empty. */
  opt(id: string, check?: Check): number | null;
  /** The value of a choice field. */
  choice(id: string): string;
  /** A list of numbers in SI units, such as a position vector. */
  vector(id: string, count: number): number[];
  /** The lines of a rows field, each as SI numbers for its columns. */
  rows(id: string): number[][];
  /** The lines of a rows field as words, for lines that start with a name. */
  words(id: string): string[][];
  /** The unit symbol a field is in. */
  unit(id: string): string;
}

/** A typed number: null when empty, NaN when it is not a number. Takes 1.5e-3, 1.5×10^-3, a true minus, and 1,000. */
export function parseNumber(text: string): number | null {
  const raw = text
    .trim()
    .replace(/[−–]/g, '-')
    .replace(/\s+/g, '')
    .replace(/,(?=\d{3}(\D|$))/g, '')
    .replace(/[×x*]10\^?/i, 'e');
  if (raw === '') return null;
  return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(raw) ? Number(raw) : NaN;
}

const split = (line: string): string[] =>
  line
    .replace(/[−–]/g, '-')
    .split(/[,;\s]+/)
    .filter((part) => part !== '');

function checked(value: number, check: Check, field: FieldDef): number {
  const labels = { field: field.label };
  if (check === 'positive' && !(value > 0)) fail('kitPhysics.errors.positive', undefined, labels);
  if (check === 'nonNegative' && value < 0) fail('kitPhysics.errors.nonNegative', undefined, labels);
  if (typeof check === 'object') {
    const low = check.min ?? -Infinity;
    const high = check.max ?? Infinity;
    if (value < low || value > high || (check.above !== undefined && !(value > check.above)))
      fail('kitPhysics.errors.range', { min: String(check.above ?? low), max: String(high) }, labels);
  }
  return value;
}

/** A reader over the fields of a mode, with the units the person picked or the system's defaults. */
export function makeReader(mode: ModeDef, inputs: ToolInputs, system: UnitSystem): Reader {
  const field = (id: string): FieldDef => {
    const found = mode.fields.find((one) => one.id === id);
    if (!found) throw new Error(`No field ${id}`);
    return found;
  };
  const unitFor = (def: FieldDef, key = def.id, column?: { dim?: FieldDef['dim']; unit?: string }) => {
    const dim = column ? column.dim : def.dim;
    if (!dim) return '';
    const picked = inputs.unit[key];
    if (picked && unitOf(dim, picked)) return picked;
    return column ? defaultUnit(dim, system, column.unit) : defaultUnit(dim, system, def.unit, def.usUnit);
  };
  const si = (def: FieldDef, value: number, key = def.id, column?: { dim?: FieldDef['dim']; unit?: string }) => {
    const dim = column ? column.dim : def.dim;
    return dim ? toSI(value, dim, unitFor(def, key, column)) : value;
  };
  const text = (id: string) => inputs.text[id] ?? field(id).initial;
  const opt = (id: string, check: Check = 'any'): number | null => {
    const def = field(id);
    const value = parseNumber(text(id));
    if (value === null) return null;
    if (Number.isNaN(value)) fail('kitPhysics.errors.notNumber', undefined, { field: def.label });
    return checked(si(def, value), check, def);
  };
  const lines = (id: string) =>
    text(id)
      .split(/\r?\n/)
      .map(split)
      .filter((parts) => parts.length > 0);
  return {
    opt,
    num(id, check = 'any') {
      const value = opt(id, check);
      if (value === null) fail('kitPhysics.errors.missing', undefined, { field: field(id).label });
      return value;
    },
    choice: (id) => text(id),
    unit: (id) => unitFor(field(id)),
    vector(id, count) {
      const def = field(id);
      const parts = split(text(id)).map(parseNumber);
      if (parts.length !== count || parts.some((part) => part === null || Number.isNaN(part)))
        fail('kitPhysics.errors.count', { count: String(count) }, { field: def.label });
      return parts.map((part) => si(def, part as number));
    },
    words: (id) => lines(id),
    rows(id) {
      const def = field(id);
      const columns = def.columns ?? [];
      const all = lines(id);
      if (all.length === 0) fail('kitPhysics.errors.noRows', undefined, { field: def.label });
      return all.map((parts, line) => {
        const numbers = parts.map(parseNumber);
        if (numbers.length !== columns.length || numbers.some((part) => part === null || Number.isNaN(part)))
          fail(
            'kitPhysics.errors.rowCount',
            { line: String(line + 1), count: String(columns.length) },
            { field: def.label },
          );
        return numbers.map((part, i) => si(def, part as number, `${id}.${i}`, columns[i]));
      });
    },
  };
}

/** Runs a mode: the outcome, or the first problem with the fields. */
export function solveMode(mode: ModeDef, inputs: ToolInputs, system: UnitSystem): Outcome {
  try {
    const outcome = mode.solve(makeReader(mode, inputs, system));
    if (outcome.ok && outcome.rows.some((row) => typeof row.value === 'number' && !Number.isFinite(row.value)))
      return { ok: false, problem: { key: 'kitPhysics.errors.nonFinite' } };
    return outcome;
  } catch (error) {
    if (error instanceof FieldProblem) return { ok: false, problem: error.step };
    return { ok: false, problem: { key: 'kitPhysics.errors.failed' } };
  }
}

/** What a tool keeps: the mode that is shown, and the text and units of every mode the person has used. */
export interface ToolState {
  mode: string;
  modes: Record<string, { text: Record<string, string>; unit: Record<string, string> }>;
}

const record = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).filter(([, one]) => typeof one === 'string')) as Record<
    string,
    string
  >;
};

/** Saved state if it still fits the tool, else the first mode with nothing typed. */
export function readState(spec: ToolSpec, saved: unknown): ToolState {
  const value = saved as Partial<ToolState> | null;
  const mode = spec.modes.find((one) => one.id === value?.mode) ?? spec.modes[0];
  const modes: ToolState['modes'] = {};
  if (value && typeof value.modes === 'object' && value.modes) {
    for (const [id, one] of Object.entries(value.modes)) {
      if (spec.modes.some((known) => known.id === id))
        modes[id] = { text: record((one as { text?: unknown }).text), unit: record((one as { unit?: unknown }).unit) };
    }
  }
  return { mode: mode.id, modes };
}

/** The shown mode and its inputs: what the person typed, and each other field's starting text. */
export function currentInputs(spec: ToolSpec, state: ToolState): { mode: ModeDef; inputs: ToolInputs } {
  const mode = spec.modes.find((one) => one.id === state.mode) ?? spec.modes[0];
  const kept = state.modes[mode.id] ?? { text: {}, unit: {} };
  const text = Object.fromEntries(mode.fields.map((one) => [one.id, kept.text[one.id] ?? one.initial]));
  return { mode, inputs: { mode: mode.id, text, unit: { ...kept.unit } } };
}
