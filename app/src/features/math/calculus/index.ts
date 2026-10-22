// Calculus for equations and page lines: derivatives, integrals, limits, and sums, solved when the question ends in
// "=" and explained step by step. Pure TypeScript with no screen, so it runs in tests and loads only when needed.
//
// - calculusAnswer(source, options) reads and answers a question. The source is LaTeX or plain text.
// - suggestion(source, options) is the answer to offer while writing: only for a question that ends in "=".
// - stepsFor(latex) is the worked steps for the equation panel's Steps.
import { formatExpression } from '../../../core/expr';
import { Unsupported } from '../actions/convert';
import { expression, readQuestion } from './read';
import type { KnownFunction, Question, ReadOptions } from './read';
import { solveQuestion } from './solve';
import type { Answer, Solved } from './types';

export type { Answer, NoAnswer, Solved, Step, StepRule } from './types';
export type { KnownFunction, Question, ReadOptions } from './read';
export { readQuestion } from './read';
export { solveQuestion } from './solve';

const CACHE_SIZE = 200;
const cache = new Map<string, Solved>();

const boundKey = (b: unknown) =>
  b && typeof b === 'object' && 'node' in b ? formatExpression((b as { node: never }).node) : JSON.stringify(b);

function questionKey(q: Question): string {
  const parts: string[] = [q.kind, q.x, formatExpression(q.body)];
  if (q.kind === 'derivative') parts.push(String(q.order), String(q.partial), q.at ? formatExpression(q.at) : '');
  if (q.kind === 'integral') parts.push(boundKey(q.from), boundKey(q.to));
  if (q.kind === 'limit') parts.push(boundKey(q.to), q.side ?? '');
  if (q.kind === 'sum') parts.push(boundKey(q.from), boundKey(q.to));
  return parts.join('|');
}

/** Solves a question, remembering recent answers, since a line is solved again as the caret moves. */
function solveRemembered(q: Question): Solved {
  const key = questionKey(q);
  const found = cache.get(key);
  if (found) return found;
  const solved = solveQuestion(q);
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value as string);
  cache.set(key, solved);
  return solved;
}

/** Definitions on earlier lines of a multi-line equation, such as f(x) = x^2 \\ f'(x) =. */
function withDefinitions(latex: string, options: ReadOptions): { last: string; options: ReadOptions } {
  const lines = latex
    .split(/\\\\/)
    .map((line) => line.replace(/&/g, '').trim())
    .filter(Boolean);
  if (lines.length < 2) return { last: latex, options };
  const known = new Map<string, KnownFunction>();
  for (const line of lines.slice(0, -1)) {
    const match = /^([a-zA-Z])\s*(?:\\left)?\(\s*([a-zA-Z])\s*(?:\\right)?\)\s*=\s*(.+)$/.exec(line);
    if (!match) continue;
    try {
      known.set(match[1], { params: [match[2]], body: expression(match[3], options.mode) });
    } catch (error) {
      if (!(error instanceof Unsupported)) throw error;
    }
  }
  const outer = options.functions;
  return {
    last: lines[lines.length - 1],
    options: { ...options, functions: (name) => known.get(name) ?? outer?.(name) },
  };
}

/** Reads and answers a calculus question. Null when the source is not one. */
export function calculusAnswer(source: string, options: ReadOptions): { asks: boolean; solved: Solved } | null {
  const { last, options: read } =
    options.mode === 'latex' ? withDefinitions(source, options) : { last: source, options };
  const found = readQuestion(last, read);
  return found && { asks: found.asks, solved: solveRemembered(found.question) };
}

/** The answer to offer while a question is written: only when it ends in "=" and has an answer. */
export function suggestion(source: string, options: ReadOptions): Answer | null {
  if (!/=\s*$/.test(source)) return null;
  const found = calculusAnswer(source, options);
  return found?.asks && found.solved.ok ? found.solved.answer : null;
}

/** Steps for an equation, when it is a calculus question (with or without the "=" at its end). */
export function stepsFor(latex: string): Solved | null {
  return calculusAnswer(latex, { mode: 'latex' })?.solved ?? null;
}
