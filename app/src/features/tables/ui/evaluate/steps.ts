// Evaluate formula (R3): steps through a formula the way a person works it out by hand. Each step finds the first
// part, inside out and left to right, that is not yet a plain value (a cell, a name, an operation, or a call whose
// arguments are all values), works it out, and writes its value in its place. A range given to a function stays a
// range, as the function reads the cells themselves.
import { parseFormula } from '../../engine/formula/parser';
import type { Node } from '../../../../core/expr/ast';
import { ERROR_TOKENS, isArray, isError, isRef } from '../../engine/values';
import type { Scalar, Value } from '../../engine/values';

/** Works out formula text (without "=") in the cell's own table and gives its value. */
export type Evaluator = (formula: string) => Value;

const LITERALS = new Set(['num', 'str', 'bool', 'array']);

/** True for a node that is already a value: a number, a text, TRUE or FALSE, an error, an array, or a minus number. */
function isLiteral(node: Node): boolean {
  if (LITERALS.has(node.type)) return true;
  if (node.type === 'name') return node.name.startsWith('#');
  return node.type === 'unary' && node.arg.type === 'num';
}

const isRange = (node: Node) => ['range', 'refop', 'struct', 'spill'].includes(node.type);

/** The parts of a node that are worked out before it, in order. */
function partsOf(node: Node): Node[] {
  switch (node.type) {
    case 'unary':
    case 'postfix':
      return [node.arg];
    case 'binary':
      return [node.left, node.right];
    case 'call':
      // A range given to a function stays a range; LAMBDA and LET keep their parts as written.
      if (node.callee || ['LAMBDA', 'LET'].includes(node.name.toUpperCase())) return [];
      return node.args.filter((arg) => !isRange(arg));
    default:
      return [];
  }
}

/** The first part to work out next, inside out, left to right, or null when the formula is a value. */
export function nextPart(node: Node): Node | null {
  if (isLiteral(node)) return null;
  for (const part of partsOf(node)) {
    const inner = nextPart(part);
    if (inner) return inner;
  }
  return node;
}

/** A scalar as a formula writes it. */
function scalarText(value: Scalar): string {
  if (value === null) return '0';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'string') return `"${value.replace(/"/g, '""')}"`;
  return ERROR_TOKENS[value.error];
}

/** A value as a formula writes it, or null for one that has no written form (a reference, a function). */
export function valueText(value: Value): string | null {
  if (isRef(value)) return null;
  if (isArray(value)) {
    const rows: string[] = [];
    for (let r = 0; r < value.rows; r += 1)
      rows.push(
        value.data
          .slice(r * value.cols, (r + 1) * value.cols)
          .map(scalarText)
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
}

/** The first step of a formula: the text as typed and the part to work out first. */
export function firstStep(formula: string): Step {
  return { text: formula, next: partSpan(formula) };
}

function partSpan(text: string): { start: number; end: number } | null {
  const parsed = parseFormula(text, undefined, { legacy: false });
  if (!parsed.ok) return null;
  const part = nextPart(parsed.node);
  return part ? { start: part.start, end: part.end } : null;
}

/** Works out the step's next part and writes its value in its place. */
export function evaluateStep(step: Step, evaluate: Evaluator): Step {
  if (!step.next) return step;
  const { start, end } = step.next;
  const value = evaluate(step.text.slice(start, end));
  const written = valueText(value);
  if (written === null) return { text: step.text, next: null };
  const text = step.text.slice(0, start) + written + step.text.slice(end);
  // A part whose value is the whole formula ends the steps.
  if (start === 0 && end === step.text.length) return { text, next: null };
  return { text, next: partSpan(text) };
}
