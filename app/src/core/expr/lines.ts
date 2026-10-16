// Lines of math in a note. Each line is plain text, a definition (`rent = 1,200`), a function (`f(x) = x^2`), a
// question (`rent * 12 =`), or an equation to graph (`y = x^2`). Lines read top to bottom, and a line sees only the
// definitions above it, so a page behaves like a worksheet. Changing a line means running the lines again, which is
// cheap. A line that is not math, or that cannot be read as math, comes back as text. It is never an error, so
// ordinary writing is left alone. A question that fails, or a definition that fails in arithmetic, is an error.

import { freeNames, type Node, type Statement } from './ast';
import type { Dialect } from './dialect';
import { asExprError, ExprError, type ExprProblem } from './errors';
import type { FormatOptions } from './numfmt';
import { formatExpression } from './print';
import { formatQuantity, type Quantity, type UnitSystem } from './quantity';
import { evaluateQuantity, type QuantityEnv, type UserFunction } from './quantityEval';
import { parseStatement } from './statement';
import type { AngleMode } from './trig';

export interface LinesOptions {
  /** The grammar. It needs `definitions: true` and `=` among its operators, and may have units. */
  dialect: Dialect;
  units: UnitSystem;
  /** Values the page does not define itself, such as pi and physical constants. */
  constants?: (name: string) => Quantity | number | undefined;
  angle?: AngleMode;
  /** How results are written. */
  format?: FormatOptions;
}

export type LineResult =
  /** Not math, or not readable as math. Leave it alone. */
  | { kind: 'text' }
  /** A question such as `rent * 12 =`. */
  | { kind: 'result'; value: Quantity; text: string; reads: string[] }
  /** A definition such as `rent = 1,200`. `shown` is true when the line also ended with an equals sign. */
  | { kind: 'define'; name: string; value: Quantity; text: string; shown: boolean; reads: string[] }
  /** A function such as `f(x) = x^2`. It can be called in later lines. */
  | { kind: 'function'; name: string; params: string[]; body: Node; bodyText: string }
  /** An equation such as `y = x^2` that the grapher can draw. `bodyText` is the right side. */
  | { kind: 'equation'; body: Node; bodyText: string }
  | { kind: 'error'; error: ExprProblem };

/** Errors that mean "this was not math after all" when a line did not ask for an answer. */
const NOT_MATH = new Set(['unknown-name', 'unknown-unit', 'arity']);

const toProblem = (error: ExprError): LineResult => ({ kind: 'error', error: error.toProblem() });

/** The text before a run of equals signs at its end, trimmed. A loop, since /=+$/ backtracks on a long run of them. */
export function dropTrailingEquals(text: string): string {
  let end = text.length;
  while (end > 0 && text[end - 1] === '=') end -= 1;
  return text.slice(0, end).trim();
}

class Page {
  private readonly variables = new Map<string, Quantity>();
  private readonly functions = new Map<string, UserFunction>();

  constructor(private readonly options: LinesOptions) {}

  private env(): QuantityEnv {
    const { constants, units, angle } = this.options;
    return {
      units,
      ...(angle === undefined ? {} : { angle }),
      name: (name) => this.variables.get(name) ?? constants?.(name),
      userFunction: (name) => this.functions.get(name),
    };
  }

  private run(node: Node): Quantity {
    return evaluateQuantity(node, this.env());
  }

  private text(value: Quantity): string {
    return formatQuantity(value, this.options.format);
  }

  /** True for a name this page gave a value or a function. */
  private owns(name: string): boolean {
    return this.variables.has(name) || this.functions.has(name);
  }

  /**
   * The dialect for one line. The page's own names, and the parameters of a function being defined, win over units of
   * the same name, so after `m = 4` the line `2m =` is 8 and not 2 meters, and in `f(t) = 5t` the t is not tonnes.
   */
  private lineDialect(params: readonly string[]): Dialect {
    const { dialect } = this.options;
    const units = dialect.units;
    if (units === undefined) return dialect;
    return { ...dialect, units: { has: (name) => !this.owns(name) && !params.includes(name) && units.has(name) } };
  }

  /** The names in the tree that the page defined, in order of first use. */
  private reads(node: Node): string[] {
    return freeNames(node).filter((name) => this.owns(name));
  }

  line(raw: string): LineResult {
    const trimmed = raw.trim();
    const shown = trimmed.endsWith('=');
    const source = shown ? dropTrailingEquals(trimmed) : trimmed;
    if (source === '') return { kind: 'text' };
    if (source.length > this.options.dialect.lex.maxLength) {
      return shown ? toProblem(new ExprError('too-long', 0, undefined, { length: source.length })) : { kind: 'text' };
    }
    let statement: Statement;
    try {
      statement = parseStatement(source, this.options.dialect, (params) => this.lineDialect(params));
    } catch (error) {
      const problem = asExprError(error);
      if (problem === null) throw error;
      // Text that does not read as math is just writing, unless the line asked for an answer.
      return shown ? toProblem(problem) : { kind: 'text' };
    }
    try {
      return this.evaluate(statement, shown);
    } catch (error) {
      const problem = asExprError(error);
      if (problem === null) throw error;
      return shown || !NOT_MATH.has(problem.code) ? toProblem(problem) : { kind: 'text' };
    }
  }

  private evaluate(statement: Statement, shown: boolean): LineResult {
    if (statement.kind === 'expr') return shown ? this.question(statement.node) : { kind: 'text' };
    if (statement.params.length > 0) return this.defineFunction(statement.name, statement.params, statement.body);
    return this.defineVariable(statement.name, statement.body, shown);
  }

  private question(node: Node): LineResult {
    const value = this.run(node);
    return { kind: 'result', value, text: this.text(value), reads: this.reads(node) };
  }

  private defineFunction(name: string, params: readonly string[], body: Node): LineResult {
    this.functions.set(name, { params, body });
    return { kind: 'function', name, params: [...params], body, bodyText: formatExpression(body) };
  }

  private defineVariable(name: string, body: Node, shown: boolean): LineResult {
    // `y = x^2`, where x has no value on this page, is an equation to graph and not a definition.
    if (name === 'y' && !this.variables.has('x') && freeNames(body).includes('x')) {
      return { kind: 'equation', body, bodyText: formatExpression(body) };
    }
    const value = this.run(body);
    this.variables.set(name, value);
    return { kind: 'define', name, value, text: this.text(value), shown, reads: this.reads(body) };
  }
}

/** Evaluates each line of a page in order. The result has one entry per line. */
export function evaluateLines(lines: readonly string[], options: LinesOptions): LineResult[] {
  const page = new Page(options);
  return lines.map((line) => page.line(line));
}
