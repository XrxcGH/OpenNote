// The text of a suggested line: numbers in a familiar exact form, values in the notation the line was written in.
import type { Node, Quantity } from '../../../core/expr';
import { amount, unitLabel } from '../../../core/expr';
import { recognize } from '../calculus/exact';
import { decimalText } from '../calculus/numeric';
import { textOf } from '../calculus/print';

/** A number as a familiar exact value when there is one (1/3, 2pi, sqrt(2)), or else six figures. */
export function numberText(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 1e12) return String(value);
  const exact = recognize(value);
  return exact ? textOf(exact) : decimalText(value);
}

/** The numbers written in a node, without 0 and 1, which rearranging adds and drops freely. */
export function numbersIn(node: Node, out = new Set<number>()): Set<number> {
  if (node.type === 'num') {
    const v = Math.abs(node.value);
    if (v !== 0 && v !== 1) out.add(v);
  } else if (node.type === 'unary' || node.type === 'postfix') numbersIn(node.arg, out);
  else if (node.type === 'binary') {
    numbersIn(node.left, out);
    numbersIn(node.right, out);
  } else if (node.type === 'call') for (const arg of node.args) numbersIn(arg, out);
  return out;
}

/**
 * A value for a suggestion, in an exact form built from a number of the line before when one fits: 2x = ln 7 after
 * e^(2x) = 7, x = ln(7)/2, or sqrt(5), rather than its decimal. Else numberText.
 */
export function exactText(value: number, before: Node): string {
  if (Number.isInteger(value) || recognize(value)) return numberText(value);
  const near = (x: number) => Math.abs(x - value) <= 1e-9 * Math.max(1, Math.abs(value));
  const numbers = [...numbersIn(before)].filter((n) => n > 0 && Number.isInteger(n) && n < 1e6);
  for (const n of numbers) {
    if (near(Math.log(n))) return `ln ${n}`;
    if (near(-Math.log(n))) return `-ln ${n}`;
    if (near(Math.sqrt(n))) return `sqrt(${n})`;
  }
  for (const n of numbers) {
    for (const m of numbers) {
      if (near(Math.log(n) / m)) return `ln(${n})/${m}`;
      if (m !== n && near(Math.log(n) / Math.log(m))) return `ln(${n})/ln(${m})`;
    }
  }
  return numberText(value);
}

/**
 * A quantity for a suggestion, rounded to the places the student wrote, or as few more as make it exact, at most 4:
 * 3 ft + 2 in, then = 5 ft, suggests = 3.1667 ft, not = 3.16666666667 ft.
 */
export function quantityText(q: Quantity, written: string): string {
  const value = amount(q);
  const used = /\d\.(\d+)/.exec(written)?.[1].length ?? 0;
  let places = Math.min(used, 4);
  while (places < 4 && Math.abs(Number(value.toFixed(places)) - value) > 1e-9 * Math.max(1, Math.abs(value)))
    places += 1;
  const label = unitLabel(q);
  const number = String(Number(value.toFixed(places)));
  return label === '' ? number : `${number} ${label}`;
}

/** A vector the line wrote as (1, 2) or ⟨1, 2⟩: its fix is written the same way, not as [1, 2]. */
export function keepBrackets(suggestion: string, raw: string): string {
  const vector = /\[([^[\]]*)\]$/.exec(suggestion);
  if (!vector || suggestion.lastIndexOf('[') !== vector.index) return suggestion;
  const [open, close] = raw.includes('⟨')
    ? ['⟨', '⟩']
    : /\(\s*-?[\d.]+\s*(?:,\s*-?[\d.]+\s*)+\)/.test(raw) && !raw.includes('[')
      ? ['(', ')']
      : [];
  return open ? `${suggestion.slice(0, vector.index)}${open}${vector[1]}${close}` : suggestion;
}
