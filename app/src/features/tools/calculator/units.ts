// Unit conversion for twelve categories. Months and years are averages (30.4375 and 365.25 days), "cal" is the
// thermochemical calorie, and "kB" is 1000 bytes while "KiB" is 1024. Temperature converts a reading, not a
// difference, so converting 10 °C to kelvin gives 283.15 and not 10.

import { snap } from '../../../core/expr';
import { MAX_LENGTH } from './dialect';
import { TEMPERATURE_ROWS, UNIT_ROWS, type UnitCategory } from './unitData';

export type { UnitCategory } from './unitData';

export interface UnitDef {
  /** The symbol, such as "km". It is the unit's identity in saved data. */
  id: string;
  category: UnitCategory;
  /** How many base units one of this unit is. Unused for temperature. */
  factor: number;
}

export type ConvertFailure = 'unknown-unit' | 'different-kinds' | 'below-absolute-zero';
export type ConvertResult = { ok: true; value: number } | { ok: false; reason: ConvertFailure };

export const UNIT_CATEGORIES: readonly UnitCategory[] = [
  'length',
  'mass',
  'time',
  'temperature',
  'area',
  'volume',
  'speed',
  'pressure',
  'energy',
  'power',
  'angle',
  'data',
];

function plurals(name: string): string[] {
  if (!/^[a-z ]{4,}$/i.test(name) || name.endsWith('s')) return [name];
  return [name, name.includes(' per ') ? name.replace(' per ', 's per ') : `${name}s`];
}

const DEFS: UnitDef[] = [];
const EXACT = new Map<string, UnitDef>();
const LOWER = new Map<string, UnitDef | null>();

function register(def: UnitDef, names: readonly string[]): void {
  DEFS.push(def);
  const all = [def.id, ...names.flatMap(plurals)];
  for (const name of all) {
    if (!EXACT.has(name)) EXACT.set(name, def);
    const key = name.toLowerCase();
    const seen = LOWER.get(key);
    LOWER.set(key, seen === undefined || seen === def ? def : null);
  }
}

for (const [category, rows] of Object.entries(UNIT_ROWS)) {
  for (const [id, factor, ...names] of rows) register({ id, category: category as UnitCategory, factor }, names);
}
for (const [id, ...names] of TEMPERATURE_ROWS) register({ id, category: 'temperature', factor: 1 }, names);

/** The unit for a symbol or name, such as "km", "Kilometers", or "°F". Returns null if unknown or ambiguous. */
export function findUnit(text: string): UnitDef | null {
  const name = text.trim().replace(/\s+/g, ' ');
  return EXACT.get(name) ?? LOWER.get(name.toLowerCase()) ?? null;
}

/** The unit for a name written exactly as the unit's symbol or one of its names, with the same case. */
export function findUnitAsWritten(text: string): UnitDef | null {
  return EXACT.get(text.trim().replace(/\s+/g, ' ')) ?? null;
}

/** The symbols in a category, smallest to largest where that makes sense. */
export function unitsIn(category: UnitCategory): string[] {
  return DEFS.filter((d) => d.category === category).map((d) => d.id);
}

// Temperatures convert through degrees from the freezing point of water, in Celsius-size degrees. Every offset is
// added or subtracted once, so the common cases come out clean: 100 °C is 212 °F, and -40 is -40 in both.
const TO_FREEZING: Record<string, (v: number) => number> = {
  C: (v) => v,
  K: (v) => v - 273.15,
  F: (v) => ((v - 32) * 5) / 9,
  R: (v) => ((v - 491.67) * 5) / 9,
};
const FROM_FREEZING: Record<string, (d: number) => number> = {
  C: (d) => d,
  K: (d) => d + 273.15,
  F: (d) => (d * 9) / 5 + 32,
  R: (d) => (d * 9) / 5 + 491.67,
};

function convertTemperature(value: number, from: string, to: string): ConvertResult {
  const degrees = TO_FREEZING[from](value);
  if (degrees < -273.15 - 1e-9) return { ok: false, reason: 'below-absolute-zero' };
  const result = FROM_FREEZING[to](degrees);
  // An offset leaves noise of about 1e-14, so a result that small next to the offsets is zero.
  return { ok: true, value: Math.abs(result) < 1e-11 * (Math.abs(value) + 300) ? 0 : snap(result) };
}

/** Converts a value between two units of the same category. */
export function convert(value: number, from: string, to: string): ConvertResult {
  const source = findUnit(from);
  const target = findUnit(to);
  if (!source || !target) return { ok: false, reason: 'unknown-unit' };
  if (source.category !== target.category) return { ok: false, reason: 'different-kinds' };
  if (source.category === 'temperature') return convertTemperature(value, source.id, target.id);
  return { ok: true, value: snap((value * source.factor) / target.factor) };
}

// Each pattern reads its text one way only, so a long run of digits or spaces cannot make it backtrack.
const NUMBER = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*/;
const CONNECTOR = /\s+(?:to|in|as|into|->|→)\s+/gi;

/** Reads "5 km to mi" or "72 F in C". Returns null if the text isn't in that form or is too long to be. */
export function parseConversion(text: string): { value: number; from: string; to: string } | null {
  if (text.length > MAX_LENGTH) return null;
  const number = NUMBER.exec(text);
  if (number === null) return null;
  const rest = text.slice(number[0].length);
  // The first connecting word that has a unit on each side, as in "5 in to cm" where the first "in" is the unit.
  for (const connector of rest.matchAll(CONNECTOR)) {
    const to = rest.slice(connector.index + connector[0].length).trimEnd();
    if (connector.index > 0 && to !== '') return { value: Number(number[1]), from: rest.slice(0, connector.index), to };
  }
  return null;
}

/** Converts text such as "5 km to mi". Returns null if the text isn't in that form. */
export function convertText(text: string): ConvertResult | null {
  const parsed = parseConversion(text);
  return parsed ? convert(parsed.value, parsed.from, parsed.to) : null;
}
