// Step-by-step working for the equation panel's Steps: derivatives, integrals, limits, and sums, from the calculus
// engine (features/math/calculus). Each step names its rule and may hold the steps inside it, so long working folds.
// An equation that is not a calculus question gets the steps of its derivative, as before: y = x^2 and x^3 + 2x both
// show how to differentiate the expression. What cannot be worked out says so, without guessing.
import { freeNames } from '../../../core/expr';
import type { Node } from '../../../core/expr';
import { calculusAnswer } from '../calculus';
import type { NoAnswer, Step } from '../calculus';
import { derivativeSteps as explain } from '../calculus/derivative';
import { latexOf } from '../calculus/print';
import { expression } from '../calculus/read';
import { Unsupported } from './convert';

export type { Step, StepRule } from '../calculus';

export type StepsKind = 'derivative' | 'integral' | 'limit' | 'sum';

export type StepsResult =
  { ok: true; kind: StepsKind; steps: Step[]; result: string } | { ok: false; reason: NoAnswer; steps: Step[] };

const CONSTANTS = new Set(['pi', 'e', 'tau', 'phi']);

function parse(latex: string): Node | null {
  try {
    return expression(latex, 'latex');
  } catch (error) {
    if (error instanceof Unsupported) return null;
    throw error;
  }
}

/** The derivative of an expression, or of the right side of y = ... or f(x) = .... */
function expressionSteps(latex: string): StepsResult {
  const at = latex.indexOf('=');
  const body =
    at >= 0 && /^\s*(?:y|[a-zA-Z]\s*(?:\\left)?\(\s*[a-z]\s*(?:\\right)?\))\s*=/.test(latex)
      ? latex.slice(at + 1)
      : latex;
  if (body.includes('=')) return { ok: false, reason: 'unsupported', steps: [] };
  const node = parse(body);
  if (!node) return { ok: false, reason: 'unsupported', steps: [] };
  const names = freeNames(node).filter((name) => !CONSTANTS.has(name));
  const x = names.includes('x') ? 'x' : names.length <= 1 ? (names[0] ?? 'x') : null;
  if (!x) return { ok: false, reason: 'letters', steps: [] };
  try {
    const { steps, result } = explain(node, x);
    return { ok: true, kind: 'derivative', steps, result: latexOf(result) };
  } catch {
    return { ok: false, reason: 'unsupported', steps: [] };
  }
}

/** Steps for a calculus question, or else for the derivative of the expression. */
export function stepsLatex(latex: string): StepsResult {
  if (latex.length > 2000) return { ok: false, reason: 'unsupported', steps: [] };
  const found = calculusAnswer(latex, { mode: 'latex' });
  if (!found) return expressionSteps(latex);
  const { solved } = found;
  if (!solved.ok) return { ok: false, reason: solved.reason, steps: solved.steps };
  return { ok: true, kind: solved.kind, steps: solved.steps, result: solved.answer.latex };
}

/** The working as one aligned LaTeX block, each line with its rule, for putting on the page. */
export function stepsBlock(
  steps: readonly Step[],
  name: (step: Step) => string,
  result: string,
  title: string,
): string {
  const lines: string[] = [`& \\textbf{${escapeText(title)}}`];
  const add = (step: Step, depth: number) => {
    lines.push(`& ${'\\quad '.repeat(depth)}${step.latex} && \\text{${escapeText(name(step))}}`);
    step.children?.forEach((child) => add(child, depth + 1));
  };
  steps.forEach((step) => add(step, 0));
  lines.push(`& = ${result}`);
  return `\\begin{aligned}\n${lines.join(' \\\\\n')}\n\\end{aligned}`;
}

/** Text for \text{}: the characters LaTeX treats as commands are left out. */
const escapeText = (text: string) => text.replace(/[\\{}$&#%_^~]/g, '');
