// The significant-figures helper: counting a number's figures, rounding to a count, notation, and a sig-fig-aware
// calculation. The tracker follows the usual classroom rules. Multiplying and dividing leave as many significant
// figures as the factor with the fewest. Adding and subtracting leave as many decimal places as the number with the
// fewest. Middle steps keep every digit, and only the answer is rounded, by the rule of its last step. The engine's
// own parser reads the expression, so the grammar matches the calculator.

import { parse, snap, type Node } from '../../../core/expr';
import { CALCULATOR } from '../calculator/dialect';
import { calculate } from '../calculator/evaluate';
import {
  decOf,
  parseDec,
  placeOf,
  roundToFigures,
  roundToPlace,
  sigFigsOf,
  toEngineering,
  toPlain,
  toScientific,
  valueOf,
  write,
  type Dec,
  type Notation,
} from './decimal';

export { parseDec, toEngineering, toPlain, toScientific, write };
export type { Dec, Notation };

export interface FigureCount {
  /** How many significant figures. */
  figures: number;
  /** True when trailing zeros without a decimal point might or might not count, as in 1200. */
  ambiguous: boolean;
  /** The number in scientific notation with the counted figures, such as 1.2×10³. */
  scientific: string;
  engineering: string;
}

/** Counts the significant figures of number text. Null when the text is not a number. */
export function countFigures(text: string): FigureCount | null {
  const d = parseDec(text);
  if (d === null) return null;
  return { figures: sigFigsOf(d), ambiguous: d.ambiguous, scientific: toScientific(d), engineering: toEngineering(d) };
}

/** Rounds number text to a count of significant figures and writes it in a notation. Null when it is not a number. */
export function roundFigures(text: string, figures: number, notation: Notation = 'plain'): string | null {
  const d = parseDec(text);
  if (d === null || !Number.isFinite(figures) || figures < 1 || figures > 50) return null;
  return write(roundToFigures(d, figures), notation);
}

/** Writes number text in another notation without changing its significant figures. */
export function changeNotation(text: string, notation: Notation): string | null {
  const d = parseDec(text);
  return d === null ? null : write(d, notation);
}

// --- Calculation ---------------------------------------------------------------------------------------------------

/** What a value is known to: significant figures, and the place of its last significant digit. Infinity means exact. */
export interface Tracked {
  value: number;
  /** Infinity for an exact number such as pi or a count. */
  figures: number;
  /** The exponent of the last significant digit (-2 is the hundredths), or -Infinity when exact. */
  place: number;
}

export const exact = (value: number): Tracked => ({ value, figures: Infinity, place: -Infinity });

export type RuleCode =
  /** A single number: its figures are kept. */
  | 'number'
  /** Multiplying or dividing: the fewest significant figures. */
  | 'multiply'
  /** Adding or subtracting: the fewest decimal places. */
  | 'add'
  /** A function or power: the figures of its input. */
  | 'function'
  /** Every number was exact, so nothing is rounded. */
  | 'exact';

export type SigResult =
  | {
      ok: true;
      value: number;
      figures: number;
      /** The answer written plainly, or in scientific notation when plain digits would hide how many count. */
      text: string;
      plain: string;
      scientific: string;
      engineering: string;
      rule: RuleCode;
      /** For `multiply`, the fewest figures; for `add`, the fewest decimal places. */
      limit: number;
      /** The unrounded value. */
      raw: number;
    }
  | { ok: false };

const FAIL = { ok: false } as const;
const magnitude = (value: number): number => (value === 0 ? 0 : Math.floor(Math.log10(Math.abs(value))));

function byFigures(value: number, figures: number): Tracked {
  if (!Number.isFinite(figures)) return exact(value);
  return { value, figures, place: magnitude(value) - figures + 1 };
}

function byPlace(value: number, place: number): Tracked {
  if (!Number.isFinite(place)) return exact(value);
  return { value, figures: Math.max(1, magnitude(value) - place + 1), place };
}

/** Looks up what a name is known to: undefined for a name it does not own (a constant is tried next), null to give up. */
export type NameTracker = (name: string) => Tracked | null | undefined;

interface Walk {
  source: string;
  names: NameTracker;
  rule: RuleCode;
  limit: number;
}

function operate(op: string, a: Tracked, b: Tracked, w: Walk): Tracked | null {
  if (op === '+' || op === '-') {
    const value = snap(op === '+' ? a.value + b.value : a.value - b.value);
    const place = Math.max(a.place, b.place);
    if (Number.isFinite(place)) {
      w.rule = 'add';
      w.limit = Math.max(0, -place);
    } else w.rule = 'exact';
    return byPlace(value, place);
  }
  if (op === '*' || op === '/') {
    if (op === '/' && b.value === 0) return null;
    const value = snap(op === '*' ? a.value * b.value : a.value / b.value);
    const figures = Math.min(a.figures, b.figures);
    if (Number.isFinite(figures)) {
      w.rule = 'multiply';
      w.limit = figures;
    } else w.rule = 'exact';
    return byFigures(value, figures);
  }
  if (op === '^') {
    const value = a.value ** b.value;
    if (!Number.isFinite(value)) return null;
    w.rule = Number.isFinite(a.figures) ? 'function' : 'exact';
    w.limit = a.figures;
    return byFigures(
      snap(value),
      Number.isInteger(b.value) || b.figures === Infinity ? a.figures : Math.min(a.figures, b.figures),
    );
  }
  return null;
}

function track(node: Node, w: Walk): Tracked | null {
  switch (node.type) {
    case 'num': {
      const d = parseDec(node.text);
      if (d === null) return null;
      w.rule = 'number';
      w.limit = sigFigsOf(d);
      return { value: node.value, figures: sigFigsOf(d), place: placeOf(d) };
    }
    case 'name': {
      const known = w.names(node.name);
      if (known !== undefined) return known;
      // The calculator's answer and memory slots have no known figures.
      if (node.name === 'ans' || /^m[1-9]$/.test(node.name)) return null;
      const result = calculate(node.name);
      return result.ok ? exact(result.value) : null;
    }
    case 'unary': {
      const inner = track(node.arg, w);
      if (inner === null || node.op === '√') return node.op === '√' && inner !== null ? root(inner, w) : null;
      return node.op === '-' ? { ...inner, value: -inner.value } : inner;
    }
    case 'postfix': {
      const inner = track(node.arg, w);
      if (inner === null || node.op === '°') return null;
      if (node.op === '%') return { ...inner, value: snap(inner.value / 100), place: inner.place - 2 };
      return null;
    }
    case 'binary': {
      if (node.op === 'mod') return null;
      // A whole number written against a name, as in 2pi or 4x, is a count in a formula and not a measurement.
      const side = (one: Node, other: Node): Tracked | null =>
        node.implicit === true && one.type === 'num' && other.type !== 'num' ? exact(one.value) : track(one, w);
      const left = side(node.left, node.right);
      const right = left === null ? null : side(node.right, node.left);
      return left === null || right === null ? null : operate(node.op, left, right, w);
    }
    case 'call': {
      const args = node.args.map((arg) => track(arg, w));
      if (args.some((arg) => arg === null) || args.length === 0) return null;
      const figures = Math.min(...args.map((arg) => (arg as Tracked).figures));
      const result = calculate(`${node.name}(${args.map((arg) => String((arg as Tracked).value)).join(', ')})`);
      if (!result.ok) return null;
      w.rule = Number.isFinite(figures) ? 'function' : 'exact';
      w.limit = figures;
      return byFigures(result.value, figures);
    }
    default:
      return null;
  }
}

function root(inner: Tracked, w: Walk): Tracked | null {
  if (inner.value < 0) return null;
  w.rule = Number.isFinite(inner.figures) ? 'function' : 'exact';
  w.limit = inner.figures;
  return byFigures(Math.sqrt(inner.value), inner.figures);
}

/** Tracks a parsed expression. Null when it holds something the rules do not cover (units, degrees, unknown names). */
export function trackNode(
  node: Node,
  source: string,
  names: NameTracker = () => undefined,
): { tracked: Tracked; rule: RuleCode; limit: number } | null {
  const w: Walk = { source, names, rule: 'number', limit: Infinity };
  const tracked = track(node, w);
  return tracked === null ? null : { tracked, rule: w.rule, limit: w.limit };
}

/** Writes a tracked value to its place, in the plainest notation that keeps its figures clear. */
export function finish(tracked: Tracked, rule: RuleCode, limit: number): SigResult {
  if (!Number.isFinite(tracked.figures)) {
    const text = String(snap(tracked.value));
    const d = decOf(snap(tracked.value));
    return {
      ok: true,
      value: tracked.value,
      figures: Infinity,
      text,
      plain: text,
      scientific: toScientific(d),
      engineering: toEngineering(d),
      rule: 'exact',
      limit: Infinity,
      raw: tracked.value,
    };
  }
  let rounded = roundToPlace(decOf(tracked.value), tracked.place);
  // Products and powers keep their count of figures when rounding carries (9.96 with two figures is 10, not 10.0).
  if (rule !== 'add' && rounded.digits.length > tracked.figures) {
    rounded = { ...rounded, digits: rounded.digits.slice(0, tracked.figures), point: false };
  }
  const figures = sigFigsOf(rounded);
  const plain = toPlain(rounded);
  // Digits before the point that end in zeros could read as more or fewer figures, so those are written in powers of ten.
  const hidden = tracked.place > 0 && figures < rounded.exp + 1;
  return {
    ok: true,
    value: valueOf(rounded),
    figures: tracked.figures,
    text: hidden ? toScientific(rounded) : plain,
    plain,
    scientific: toScientific(rounded),
    engineering: toEngineering(rounded),
    rule,
    limit,
    raw: tracked.value,
  };
}

/** Calculates an expression the sig-fig way. `{ ok: false }` when the expression cannot be tracked. */
export function sigFigCalculate(source: string, names: NameTracker = () => undefined): SigResult {
  const text = source.trim();
  if (text === '') return FAIL;
  try {
    const found = trackNode(parse(text, CALCULATOR), text, names);
    return found === null ? FAIL : finish(found.tracked, found.rule, found.limit);
  } catch {
    return FAIL;
  }
}

/** A number written for a count of figures that suits a rule: used by the explanation's plain-words example. */
export function figuresIn(result: SigResult): number | null {
  return result.ok && Number.isFinite(result.figures) ? result.figures : null;
}

/** Rounds a ready value to figures. A thin wrapper so callers need not know the digit form. */
export function roundValue(value: number, figures: number, notation: Notation = 'plain'): string {
  return write(roundToFigures(decOf(value), figures), notation);
}
