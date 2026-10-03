// Runs an expression. Sums, differences, and products are snapped to 15 digits, so 0.1 + 0.2 is 0.3. Other steps
// keep full precision, so sqrt(2)^2 and (1/3)*3 don't drift, and the final answer is snapped once. A result that
// isn't a finite number is an error. It is never NaN or Infinity. Reading and running are the shared engine's work.

import { asExprError, compileNode, parse, snap, type AngleMode, type ExprProblem } from '../../../core/expr';
import { findConstant } from './constants';
import { CALCULATOR, TABLE } from './dialect';
import type { CalcError, CalcErrorCode, CalcResult } from './errors';

/** What an expression can read: the angle mode, the last answer ("ans"), and the memory slots ("m1" to "m9"). */
export interface EvalContext {
  angle: AngleMode;
  ans: number;
  memory: readonly (number | null)[];
}

export const DEFAULT_CONTEXT: EvalContext = { angle: 'deg', ans: 0, memory: [] };

const MEMORY_NAME = /^m([1-9])$/;
const CODES: ReadonlySet<string> = new Set<CalcErrorCode>([
  'empty',
  'too-long',
  'too-deep',
  'bad-character',
  'bad-number',
  'unexpected-token',
  'unexpected-end',
  'unclosed-paren',
  'needs-parens',
  'unknown-name',
  'arity',
  'domain',
  'divide-by-zero',
  'overflow',
]);

/** A reader for a name, or undefined when it has no value. */
function reader(name: string, context: EvalContext): (() => number) | undefined {
  if (name === 'ans') return () => context.ans;
  const slot = MEMORY_NAME.exec(name);
  if (slot) return () => context.memory[Number(slot[1]) - 1] ?? 0;
  const constant = findConstant(name);
  return constant ? () => constant.value : undefined;
}

/** The calculator's view of an engine problem. A missing bracket is reported at the bracket that opened it. */
function toCalcError(problem: ExprProblem): CalcError {
  const code = (CODES.has(problem.code) ? problem.code : 'unexpected-token') as CalcErrorCode;
  const position = code === 'unclosed-paren' && problem.related !== undefined ? problem.related : problem.position;
  return problem.detail === undefined ? { code, position } : { code, position, detail: problem.detail };
}

/** Parses and evaluates an expression. Returns an error value instead of throwing. */
export function calculate(source: string, context: EvalContext = DEFAULT_CONTEXT): CalcResult {
  try {
    const run = compileNode<void>(parse(source, CALCULATOR), {
      strict: true,
      snap: true,
      table: TABLE,
      angle: () => context.angle,
      bind: (name) => reader(name, context),
    });
    return { ok: true, value: snap(run()) };
  } catch (error) {
    const problem = asExprError(error);
    if (problem !== null) return { ok: false, error: toCalcError(problem.toProblem()) };
    throw error;
  }
}
