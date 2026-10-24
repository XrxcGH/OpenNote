// Fields and expressions for vector calculus: splitting "P, Q, R" into components, differentiating an expression
// text, and the small vector operations the integrals use. Expressions are the shared engine's, so nothing runs as code.
import { compile, derivative, latexOf, namesIn, read, readFunction, show, tidy, type Fn } from '../expr';
import { KitError } from '../types';

/** Splits on commas, semicolons, and lines that are not inside brackets. */
export function splitTop(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (depth === 0 && (ch === ',' || ch === ';' || ch === '\n')) {
      parts.push(current);
      current = '';
    } else current += ch;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** The components of a vector typed as "P, Q, R" or "(P, Q, R)" or "<P, Q, R>". */
export function components(text: string, counts: readonly number[], name = 'F'): string[] {
  let t = text.trim();
  if (
    (t.startsWith('(') && t.endsWith(')') && splitTop(t.slice(1, -1)).length > 1) ||
    (t.startsWith('<') && t.endsWith('>'))
  ) {
    t = t.slice(1, -1);
  }
  const parts = splitTop(t);
  if (!counts.includes(parts.length)) throw new KitError('vcComponents', `${name}: ${counts.join(' or ')}`);
  return parts;
}

/** The names in an expression, in the given order, left out when they are not used. */
export function usedVariables(texts: readonly string[], order: readonly string[]): string[] {
  const used = new Set<string>();
  for (const t of texts) namesIn(read(t), used);
  return order.filter((v) => used.has(v));
}

/** Checks that an expression uses only the allowed variables. */
export function checkNames(text: string, allowed: readonly string[]): void {
  const bad = [...namesIn(read(text))].find((n) => !allowed.includes(n));
  if (bad) throw new KitError('unknown-name', bad);
}

/** The partial derivative of an expression text, as simplified text. */
export function partial(text: string, variable: string): string {
  return show(derivative(read(text), variable));
}

/** An expression text tidied: simplified, with the same meaning. */
export function simplified(text: string): string {
  return show(tidy(read(text)));
}

export const tex = (text: string): string => latexOf(text);

export const compiled = (text: string, vars: readonly string[]): Fn => readFunction(text, vars);

export function compiledMany(
  texts: readonly string[],
  vars: readonly string[],
): (values: readonly number[]) => number[] {
  const fns = texts.map((t) => compile(read(t), vars));
  return (values) => fns.map((f) => f(values));
}

export const dotV = (a: readonly number[], b: readonly number[]): number => a.reduce((s, v, i) => s + v * b[i], 0);
export const normV = (a: readonly number[]): number => Math.sqrt(dotV(a, a));
export const crossV = (a: readonly number[], b: readonly number[]): number[] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Text for a symbolic sum, dropping zero terms. */
export function sumText(terms: readonly string[]): string {
  const live = terms.filter((t) => t !== '0' && t !== '');
  return live.length ? simplified(live.map((t) => `(${t})`).join('+')) : '0';
}

export const isZeroText = (t: string): boolean => t === '0' || t === '-0';
