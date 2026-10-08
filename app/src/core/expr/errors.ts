// What can go wrong in an expression. Every failure has a code, a place in the source text, and sometimes a name.
// The codes are for the screen that shows them to turn into words. None of them carries interface text.

export type ExprErrorCode =
  // Reading the text.
  | 'empty'
  | 'too-long'
  | 'too-deep'
  | 'bad-character'
  | 'bad-number'
  | 'unclosed-quote'
  | 'unclosed-bracket'
  // Reading the structure.
  | 'unexpected-token'
  | 'unexpected-end'
  | 'unclosed-paren'
  | 'needs-parens'
  | 'missing-argument'
  | 'bad-power'
  | 'bad-reference'
  | 'bad-row'
  // Using the tree.
  | 'unknown-name'
  | 'unknown-unit'
  | 'unit-mismatch'
  | 'arity'
  | 'domain'
  | 'divide-by-zero'
  | 'overflow'
  | 'not-differentiable';

/** The plain-data form of an error, safe to save or send between workers. */
export interface ExprProblem {
  code: ExprErrorCode;
  /** Where the problem starts, as a count of UTF-16 code units from the start of the source. -1 means no place. */
  position: number;
  /** How many code units the problem covers. At least 1, except at the end of the text where it is 0. */
  length: number;
  /** The name or text involved: the token for 'unexpected-token', the function for 'arity', and so on. */
  detail?: string;
  /** A second place that explains the first, such as the opening bracket that a missing closing bracket belongs to. */
  related?: number;
  /** What the parser wanted here, such as a closing bracket or a number, when it can say. */
  expected?: string;
}

/** Thrown inside the lexer, parser, and evaluator. The edges of the engine turn it into a result value. */
export class ExprError extends Error implements ExprProblem {
  readonly code: ExprErrorCode;
  readonly position: number;
  readonly length: number;
  readonly detail?: string;
  readonly related?: number;
  readonly expected?: string;

  constructor(code: ExprErrorCode, position = -1, detail?: string, extra: Partial<ExprProblem> = {}) {
    super(code);
    this.name = 'ExprError';
    this.code = code;
    this.position = position;
    this.length = Math.max(0, extra.length ?? detail?.length ?? 1);
    if (detail !== undefined) this.detail = detail;
    if (extra.related !== undefined) this.related = extra.related;
    if (extra.expected !== undefined) this.expected = extra.expected;
  }

  /** The same error with a place and name, unless it already has a place. */
  at(position: number, detail?: string, length?: number): ExprError {
    if (this.position >= 0) return this;
    const extra: Partial<ExprProblem> = { length: length ?? this.length };
    if (this.related !== undefined) extra.related = this.related;
    if (this.expected !== undefined) extra.expected = this.expected;
    return new ExprError(this.code, position, this.detail ?? detail, extra);
  }

  toProblem(): ExprProblem {
    const problem: ExprProblem = { code: this.code, position: this.position, length: this.length };
    if (this.detail !== undefined) problem.detail = this.detail;
    if (this.related !== undefined) problem.related = this.related;
    if (this.expected !== undefined) problem.expected = this.expected;
    return problem;
  }
}

/**
 * The error as an ExprError: itself, 'too-deep' when the engine ran out of stack walking a tree, or null for anything
 * else, which is a bug. The parser keeps trees shallow, so running out of stack is a last line of defense.
 */
export function asExprError(error: unknown): ExprError | null {
  if (error instanceof ExprError) return error;
  const overflow = error instanceof RangeError && /call stack|recursion/i.test(error.message);
  return overflow ? new ExprError('too-deep') : null;
}

/** A result that carries a value or a problem. The engine's entry points return this and never throw. */
export type Outcome<T> = { ok: true; value: T } | { ok: false; error: ExprProblem };

/** Runs a step that may throw an ExprError and returns it as an Outcome. Other errors are bugs and pass through. */
export function attempt<T>(step: () => T): Outcome<T> {
  try {
    return { ok: true, value: step() };
  } catch (error) {
    const problem = asExprError(error);
    if (problem !== null) return { ok: false, error: problem.toProblem() };
    throw error;
  }
}

/**
 * Two lines for a developer console or a test failure: the source and a row of carets under the problem.
 * The interface does not use this. It builds its own message from the code.
 */
export function pointAt(source: string, problem: ExprProblem): string {
  const start = Math.max(0, Math.min(problem.position, source.length));
  return `${source}\n${' '.repeat(start)}${'^'.repeat(Math.max(1, problem.length))} ${problem.code}`;
}
