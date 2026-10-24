// Quick math: type "2.5*9.81=" and then Space, and the result follows (FEATURES.md). It shares the formula engine's
// lexer, parser, and functions, so a formula and a quick calculation always agree. Pure: the editor extension that
// calls this lives in the wiring stage.

import { compile, type Ctx } from './formula/compile';
import type { Node } from '../../../core/expr';
import { syntaxOf, type Syntax } from './formula/lexer';
import { parseFormula } from './formula/parser';
import { DEFAULT_ENV } from './recalc';
import type { Locale } from './locale';
import { isError, type ErrorCode } from './values';

/** How far back from the equals sign the expression can start. */
const LOOKBACK = 200;
const ARITHMETIC = new Set(['+', '-', '*', '/', '^']);

export type QuickMathResult =
  | { kind: 'result'; text: string; value: number; expression: string; start: number }
  | { kind: 'error'; error: ErrorCode; expression: string; start: number };

/** True when the tree is a calculation: it has an operator or function, and nothing that needs a table or text. */
function isCalculation(node: Node): { math: boolean; pure: boolean } {
  switch (node.type) {
    case 'num':
      return { math: false, pure: true };
    case 'unary':
      return node.op === '√' ? { math: true, pure: isCalculation(node.arg).pure } : isCalculation(node.arg);
    case 'postfix':
      return { math: true, pure: isCalculation(node.arg).pure };
    case 'binary': {
      const [l, r] = [isCalculation(node.left), isCalculation(node.right)];
      return { math: l.math || r.math || ARITHMETIC.has(node.op), pure: l.pure && r.pure };
    }
    case 'call': {
      const parts = node.args.map(isCalculation);
      return { math: true, pure: parts.every((p) => p.pure) };
    }
    default:
      return { math: false, pure: false };
  }
}

/** At most 10 significant digits, trailing zeros trimmed, no grouping, and scientific notation beyond 1e15. */
export function formatQuickMath(value: number, locale: Locale): string {
  if (Math.abs(value) >= 1e15) {
    const [mantissa, exponent] = value.toExponential(9).split('e');
    const trimmed = mantissa.replace(/\.?0+$/, '').replace('.', locale.decimal);
    return `${trimmed}E${exponent}`;
  }
  const format = new Intl.NumberFormat(locale.tag, { maximumSignificantDigits: 10, useGrouping: false });
  return format.format(value);
}

function isBoundary(body: string, at: number): boolean {
  const before = body[at - 1];
  if (before === undefined) return true;
  if (/[A-Za-z0-9_$]/.test(before)) return false;
  return !(/[.,]/.test(before) && /\d/.test(body[at - 2] ?? ''));
}

function evaluate(node: Node): number | ErrorCode | null {
  const scope = { columns: [], rowCount: 0, env: DEFAULT_ENV };
  const ctx: Ctx = { cols: [], row: 0, epoch: 1 };
  const value = compile(node, scope, { col: 0, row: null }).fn(ctx);
  if (isError(value)) return value.error;
  return typeof value === 'number' ? value : null;
}

function tryFrom(body: string, start: number, syntax: Syntax, locale: Locale): QuickMathResult | null {
  const expression = body.slice(start).trim();
  const parsed = parseFormula(expression, syntax);
  if (!parsed.ok) return null;
  const shape = isCalculation(parsed.node);
  if (!shape.math || !shape.pure) return null;
  const outcome = evaluate(parsed.node);
  // An unknown function name is ordinary text, such as "note(3)=", so it never announces an error.
  if (outcome === null || outcome === 'NAME') return null;
  if (typeof outcome === 'string') return { kind: 'error', error: outcome, expression, start };
  return { kind: 'result', text: formatQuickMath(outcome, locale), value: outcome, expression, start };
}

/**
 * Finds the calculation that ends at the equals sign. `before` is the text before the caret and ends with "=".
 * It tries each start from the left until the rest reads as one calculation, so "Cost: 12*3=" gives 36. Text that
 * isn't a calculation, such as "a=" or "2=", returns null. A calculation that fails, such as "1/0=", returns its
 * error so the editor can announce it without inserting anything.
 */
export function quickMath(before: string, locale: Locale): QuickMathResult | null {
  if (!before.endsWith('=')) return null;
  const offset = Math.max(0, before.length - 1 - LOOKBACK);
  const body = before.slice(offset, -1);
  const syntax = syntaxOf(locale);
  for (let at = 0; at < body.length; at++) {
    if (/\s/.test(body[at]) || !isBoundary(body, at)) continue;
    const found = tryFrom(body, at, syntax, locale);
    if (found) return { ...found, start: found.start + offset };
  }
  return null;
}
