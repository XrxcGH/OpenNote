// Whether two math answers are the same (practice exams, ADR 0052). The shared expression engine reads both, with the
// calculator's units, and compares their values: numbers and quantities directly, and expressions with letters at a
// few sample points, so 2(x + 1) and 2x + 2 match. It never throws: text it cannot read is "unreadable", and the
// person marks that answer with the key beside it.
import { dropTrailingEquals, evaluateQuantity, freeNames, mathConstant, parse } from '../../../core/expr';
import type { Dialect, Node, Quantity, UnitSystem } from '../../../core/expr';

/** The grammar and the units to read answers with: the notes dialect and the calculator's units. */
export interface MathKit {
  dialect: Dialect;
  units: UnitSystem;
}

/**
 * equal: the same value. close: within the tolerance, such as a rounded answer. unit: the right number with its unit
 * left off. different: another value or another unit. unreadable: not math the engine can read.
 */
export type MathVerdict = 'equal' | 'close' | 'unit' | 'different' | 'unreadable';

/** The longest answer read as math, and the most letters an expression may use. */
const MAX_TEXT = 240;
const MAX_NAMES = 4;
/** Values for letters, chosen to avoid the special points 0 and 1 and to differ from each other. */
const SAMPLES = [0.37, 1.61, 2.9, -1.23, 4.41];
/** Two values this close (as a share of the larger) are the same number. */
const SAME = 1e-9;

/** Writes the signs people type as the ones the engine reads, and drops "x =" in front and "=" at the end. */
export function cleanMath(text: string): string {
  let source = text
    .slice(0, MAX_TEXT + 1)
    .replace(/[×·⋅∙]/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    // The root sign takes the bracket after it, or the number or name right after it: √16 is sqrt(16).
    .replace(/√\s*\(/g, 'sqrt(')
    .replace(/√\s*([A-Za-z0-9_.]+)/g, 'sqrt($1)')
    .replace(/√/g, 'sqrt')
    .trim();
  source = dropTrailingEquals(source);
  const assigned = /^[A-Za-z][A-Za-z0-9_]{0,20}\s*=\s*([^=]+)$/.exec(source);
  if (assigned) source = (assigned[1] ?? '').trim();
  return source;
}

function read(text: string, kit: MathKit): Node | null {
  const source = cleanMath(text);
  if (source === '' || source.length > MAX_TEXT || source.includes('=')) return null;
  try {
    return parse(source, kit.dialect);
  } catch {
    return null;
  }
}

/** The letters a tree uses that are not constants like pi. */
function letters(node: Node): string[] {
  try {
    return freeNames(node).filter((name) => mathConstant(name) === undefined);
  } catch {
    return [];
  }
}

function valueOf(node: Node, kit: MathKit, values: Readonly<Record<string, number>>): Quantity | null {
  try {
    const quantity = evaluateQuantity(node, {
      units: kit.units,
      name: (name) => (Object.hasOwn(values, name) ? values[name] : mathConstant(name)),
      angle: 'rad',
    });
    return Number.isFinite(quantity.si) ? quantity : null;
  } catch {
    return null;
  }
}

/** A name of more than two letters is a word, not a variable: an answer in words is not marked as math. */
const isWord = (name: string): boolean => name.length > 2;

const plain = (quantity: Quantity): boolean => quantity.dim.every((power) => power === 0);
const sameDim = (a: Quantity, b: Quantity): boolean => a.dim.every((power, at) => power === b.dim[at]);

/** How far apart two numbers are, as a share of the larger, or as a plain gap near zero. */
function gap(a: number, b: number): number {
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return scale < 1e-12 ? Math.abs(a - b) : Math.abs(a - b) / scale;
}

/** The number a quantity shows in its own unit, as the key writes it: 20 for 20 m/s. */
function shown(quantity: Quantity): number {
  return quantity.display === null ? quantity.si : (quantity.si - quantity.display.offset) / quantity.display.factor;
}

/**
 * Compares the person's answer with the model answer. `tolerance` is how far apart (as a share of the model answer)
 * still counts, for rounded answers; 0 asks for the same value.
 */
export function compareMath(given: string, expected: string, kit: MathKit, tolerance = 0): MathVerdict {
  const want = read(expected, kit);
  const got = read(given, kit);
  if (!want || !got) return 'unreadable';
  const names = [...new Set([...letters(want), ...letters(got)])];
  if (names.length > MAX_NAMES || names.some(isWord)) return 'unreadable';
  const allowed = Math.max(SAME, Number.isFinite(tolerance) ? Math.min(Math.abs(tolerance), 0.5) : 0);
  const runs = names.length === 0 ? 1 : SAMPLES.length;
  let compared = 0;
  let close = false;
  for (let run = 0; run < runs; run += 1) {
    const values = Object.fromEntries(
      names.map((name, at) => [name, (SAMPLES[(run + at) % SAMPLES.length] ?? 1) + at * 0.11]),
    );
    const a = valueOf(got, kit, values);
    const b = valueOf(want, kit, values);
    // A point outside both answers' domain, such as sqrt(x) at a negative x, says nothing either way.
    if (!a && !b) continue;
    if (!a || !b) return b ? 'different' : 'unreadable';
    compared += 1;
    if (!sameDim(a, b)) {
      // The right number with no unit, where the key has one: the unit was left off.
      if (names.length === 0 && plain(a) && !plain(b) && gap(a.si, shown(b)) <= allowed) return 'unit';
      return 'different';
    }
    const apart = gap(a.si, b.si);
    if (apart <= SAME) continue;
    if (apart <= allowed) close = true;
    else return 'different';
  }
  if (compared === 0) return 'unreadable';
  return close ? 'close' : 'equal';
}

/** True when the text reads as math: a number, a quantity, or an expression. */
export function readsAsMath(text: string, kit: MathKit): boolean {
  const node = read(text, kit);
  if (!node) return false;
  const names = letters(node);
  if (names.length > MAX_NAMES || names.some(isWord)) return false;
  return names.length > 0 || valueOf(node, kit, {}) !== null;
}
