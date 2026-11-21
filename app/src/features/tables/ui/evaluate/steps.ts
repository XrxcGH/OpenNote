// Evaluate formula (R3): steps through a formula the way a person works it out by hand. Each step finds the first
// part, inside out and left to right, that is not yet a plain value (a cell, a name, an operation, or a call whose
// arguments are all values), works it out, and shows its value in its place. A range given to a function stays a
// range, as the function reads the cells themselves. So does a reference given to a function that reads the
// reference, not its value (ROW, ISBLANK, OFFSET, and so on).
//
// The formula is parsed once. Each part is worked out from its own text as typed, never from the value text shown in
// its place. So an empty cell stays empty (not 0), and a text that looks like a number stays a text.
import { parseFormula } from '../../engine/formula/parser';
import type { Node } from '../../../../core/expr/ast';
import { ERROR_TOKENS, isArray, isError, isRef } from '../../engine/values';
import type { Scalar, Value } from '../../engine/values';

/** Works out formula text (without "=") in the cell's own table and gives its value. */
export type Evaluator = (formula: string) => Value;

const LITERALS = new Set(['num', 'str', 'bool', 'array']);

/** Functions that read a reference itself (its place, or whether it is empty), not the value in it. */
const REFERENCE_FUNCTIONS = new Set([
  'ROW',
  'ROWS',
  'COLUMN',
  'COLUMNS',
  'ISREF',
  'ISBLANK',
  'ISFORMULA',
  'FORMULATEXT',
  'OFFSET',
  'CELL',
  'INDEX',
  'AREAS',
  'SHEET',
  'SHEETS',
]);

/**
 * Functions that read a cell's value differently from the same value typed as an argument. SUM skips a text in a cell
 * but counts a typed number text. So a cell given to one of these stays as typed, and the call is worked out whole.
 */
const AGGREGATE_FUNCTIONS = new Set([
  'SUM',
  'SUMSQ',
  'PRODUCT',
  'AVERAGE',
  'AVERAGEA',
  'COUNT',
  'COUNTA',
  'COUNTBLANK',
  'MIN',
  'MINA',
  'MAX',
  'MAXA',
  'MEDIAN',
  'MODE',
  'STDEV',
  'STDEVA',
  'STDEVP',
  'STDEV.S',
  'STDEV.P',
  'VAR',
  'VARA',
  'VARP',
  'VAR.S',
  'VAR.P',
  'AND',
  'OR',
  'XOR',
]);

/** True for a node that is already a value: a number, a text, TRUE or FALSE, an error, an array, or a minus number. */
function isLiteral(node: Node): boolean {
  if (LITERALS.has(node.type)) return true;
  if (node.type === 'name') return node.name.startsWith('#');
  return node.type === 'unary' && node.arg.type === 'num';
}

const isRange = (node: Node) => ['range', 'refop', 'struct', 'spill'].includes(node.type);
const isReference = (node: Node) => isRange(node) || ['cell', 'name', 'qualified', 'col'].includes(node.type);

/** The parts of a node that are worked out before it, in order. */
function partsOf(node: Node): Node[] {
  switch (node.type) {
    case 'unary':
    case 'postfix':
      return [node.arg];
    case 'binary':
      return [node.left, node.right];
    case 'call': {
      // LAMBDA and LET keep their parts as written.
      const name = node.name.toUpperCase();
      if (node.callee || ['LAMBDA', 'LET'].includes(name)) return [];
      const keepsRefs = REFERENCE_FUNCTIONS.has(name) || AGGREGATE_FUNCTIONS.has(name);
      return node.args.filter((arg) => !isRange(arg) && !(keepsRefs && isReference(arg)));
    }
    default:
      return [];
  }
}

/** The parts of a formula in the order the steps work them out: inside out, left to right, the whole one last. */
function orderOf(node: Node, out: Node[] = []): Node[] {
  if (isLiteral(node)) return out;
  for (const part of partsOf(node)) orderOf(part, out);
  out.push(node);
  return out;
}

/** The first part to work out next, inside out, left to right, or null when the formula is a value. */
export function nextPart(node: Node): Node | null {
  return orderOf(node)[0] ?? null;
}

/** A scalar as a formula writes it. Empty has no written form. */
function scalarText(value: Scalar): string | null {
  if (value === null) return null;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'string') return `"${value.replace(/"/g, '""')}"`;
  return ERROR_TOKENS[value.error];
}

/** A value as a formula writes it, or null for one that has no written form (empty, a reference, a function). */
export function valueText(value: Value): string | null {
  if (isRef(value)) return null;
  if (isArray(value)) {
    const rows: string[] = [];
    for (let r = 0; r < value.rows; r += 1)
      rows.push(
        value.data
          .slice(r * value.cols, (r + 1) * value.cols)
          .map((v) => scalarText(v) ?? '""')
          .join(','),
      );
    return `{${rows.join(';')}}`;
  }
  if (typeof value === 'object' && value !== null && !isError(value)) return null;
  return scalarText(value as Scalar);
}

export interface Step {
  /** The formula as it stands, without "=". */
  readonly text: string;
  /** The part the next step works out, or null when the formula is one value. */
  readonly next: { start: number; end: number } | null;
  /** The formula as typed. */
  readonly formula: string;
  /** The parts in the order they are worked out. */
  readonly order: readonly Node[];
  /** The values of the parts worked out so far, in order. */
  readonly values: readonly Value[];
}

/** The first step of a formula: the text as typed and the part to work out first. */
export function firstStep(formula: string): Step {
  const parsed = parseFormula(formula, undefined, { legacy: false });
  const order = parsed.ok ? orderOf(parsed.node) : [];
  return shown({ formula, order, values: [] });
}

/** The step's text with each worked-out part shown as its value, and where the next part now stands. */
function shown(state: Pick<Step, 'formula' | 'order' | 'values'>): Step {
  const { formula, order, values } = state;
  // Later parts hold earlier ones (the order is inside out), so the outermost worked-out parts are found from the end.
  const spans: { start: number; end: number; text: string }[] = [];
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const node = order[i]!;
    if (spans.some((s) => s.start <= node.start && node.end <= s.end)) continue;
    // A part with no written form (empty, a reference) keeps its text as typed.
    spans.push({
      start: node.start,
      end: node.end,
      text: valueText(values[i]!) ?? formula.slice(node.start, node.end),
    });
  }
  spans.sort((a, b) => a.start - b.start);
  let text = '';
  let at = 0;
  const moved = (pos: number) => {
    let shift = 0;
    for (const s of spans) if (s.end <= pos) shift += s.text.length - (s.end - s.start);
    return pos + shift;
  };
  for (const s of spans) {
    text += formula.slice(at, s.start) + s.text;
    at = s.end;
  }
  text += formula.slice(at);
  const node = order[values.length];
  const next = node ? { start: moved(node.start), end: moved(node.end) } : null;
  return { text, next, formula, order, values };
}

/** Works out the step's next part from its text as typed and shows its value in its place. */
export function evaluateStep(step: Step, evaluate: Evaluator): Step {
  const node = step.order[step.values.length];
  if (!node) return step;
  const source = step.formula.slice(node.start, node.end);
  let value = evaluate(source);
  // A formula that is only a reference to an empty cell shows 0; the step keeps it empty.
  if (value === 0 && ['cell', 'name', 'qualified'].includes(node.type) && evaluate(`ISBLANK(${source})`) === true)
    value = null;
  return shown({ formula: step.formula, order: step.order, values: [...step.values, value] });
}
