// Dialects for the engine's own tests, so core/expr does not import from the features that use it. SHEET is the
// spreadsheet dialect the table formulas use. LETTERS splits names and takes bare function arguments, like the
// grapher's dialect.

import { BASE_LEX, setOf, type Dialect } from './dialect';
import { standardFunctions } from './functions';
import { GENERAL } from './general';
import { functionLookup } from './lookup';
import type { UnitDef, UnitSystem } from './quantity';
import { sheetDialect } from './sheet';

const PLAIN = standardFunctions('plain');
const PLAIN_NAMES = [
  ...['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh'],
  ...['asinh', 'acosh', 'atanh', 'sqrt', 'cbrt', 'root', 'exp', 'ln', 'log', 'log2', 'log10', 'abs'],
  ...['floor', 'max', 'min', 'hypot', 'pow', 'gamma'],
];
const PLAIN_ALIASES = { arcsin: 'asin' };
const LETTER_NAMES = [...PLAIN_NAMES, 'arcsin', 'mod', 'x', 'y', 'a', 'b', 'c', 'pi', 'e'];

export const LETTERS: Dialect = {
  lex: {
    ...BASE_LEX,
    names: 'letters',
    operators: ['+', '-', '*', '/', '^', '!', '%', '='],
    words: { '√': 'sqrt' },
  },
  infix: setOf('+', '-', '*', '/', '^', 'mod'),
  prefix: setOf('-', '+'),
  postfix: setOf('!', '%'),
  implicit: 'free',
  functions: functionLookup(PLAIN, { names: PLAIN_NAMES, aliases: PLAIN_ALIASES, caseSensitive: true }),
  calls: 'bare',
  unknownCalls: 'multiply',
  checkArity: true,
  split: new Set(LETTER_NAMES),
  cells: false,
  strictNames: false,
  definitions: true,
  maxDepth: 200,
};

/** Stored form: a period for the decimal mark and a comma between arguments. */
export const SHEET: Dialect = sheetDialect({ decimal: '.', separator: ',' });

/** Regional form: a comma for the decimal mark and a semicolon between arguments. */
export const SHEET_COMMA: Dialect = sheetDialect({ decimal: ',', separator: ';' });

/** The general dialect with units: 5 km, 9.8 m/s^2, and 5 mi in km. */
export const WITH_UNITS: Dialect = {
  ...GENERAL,
  lex: {
    ...GENERAL.lex,
    operators: [...GENERAL.lex.operators, '=', '->'],
    aliases: { ...GENERAL.lex.aliases, '→': '->' },
  },
  units: { has: (name) => TEST_UNITS.find(name) !== undefined },
};

/** A dialect for lines of math in a note: units, groups of digits, definitions, and calls of your own functions. */
export const NOTES_TEST: Dialect = {
  ...WITH_UNITS,
  lex: { ...WITH_UNITS.lex, separators: ';', thousands: ',' },
  unknownCalls: 'call',
  definitions: true,
};

const L: [number, number, number, number, number] = [1, 0, 0, 0, 0];
const SPEED: [number, number, number, number, number] = [1, 0, -1, 0, 0];
const FORCE: [number, number, number, number, number] = [1, 1, -2, 0, 0];
const ENERGY: [number, number, number, number, number] = [2, 1, -2, 0, 0];
const KELVIN: [number, number, number, number, number] = [0, 0, 0, 1, 0];
const FAHRENHEIT = { factor: 5 / 9, offset: (459.67 * 5) / 9 };

const DEFS: UnitDef[] = [
  { id: 'm', dim: L, factor: 1 },
  { id: 'km', dim: L, factor: 1000 },
  { id: 'cm', dim: L, factor: 0.01 },
  { id: 'mm', dim: L, factor: 0.001 },
  { id: 'in', dim: L, factor: 0.0254 },
  { id: 'ft', dim: L, factor: 0.3048 },
  { id: 'mi', dim: L, factor: 1609.344 },
  { id: 'light year', dim: L, factor: 9460730472580800 },
  { id: 's', dim: [0, 0, 1, 0, 0], factor: 1 },
  { id: 'min', dim: [0, 0, 1, 0, 0], factor: 60 },
  { id: 'h', dim: [0, 0, 1, 0, 0], factor: 3600 },
  { id: 'kg', dim: [0, 1, 0, 0, 0], factor: 1 },
  { id: 'g', dim: [0, 1, 0, 0, 0], factor: 0.001 },
  { id: 'L', dim: [3, 0, 0, 0, 0], factor: 0.001 },
  { id: 'mL', dim: [3, 0, 0, 0, 0], factor: 1e-6 },
  { id: 'fl oz', dim: [3, 0, 0, 0, 0], factor: 2.95735295625e-5 },
  { id: 'mph', dim: SPEED, factor: 0.44704 },
  { id: 'N', dim: FORCE, factor: 1 },
  { id: 'J', dim: ENERGY, factor: 1 },
  { id: 'K', dim: KELVIN, factor: 1 },
  { id: 'C', dim: KELVIN, factor: 1, offset: 273.15 },
  { id: 'F', dim: KELVIN, ...FAHRENHEIT },
  { id: '°C', dim: KELVIN, factor: 1, offset: 273.15 },
  { id: '°F', dim: KELVIN, ...FAHRENHEIT },
];

const BY_ID = new Map(DEFS.map((def) => [def.id, def]));

/** A small table of units for the engine's tests. The calculator has the real one. */
export const TEST_UNITS: UnitSystem = { find: (name) => BY_ID.get(name) };
