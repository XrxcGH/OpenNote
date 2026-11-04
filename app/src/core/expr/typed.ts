// Reading a number a person typed into a form field. The expression dialect reads "2.5e" as 2.5 times Euler's number,
// which is right in a calculator and wrong in a field that asks for a number: a half-typed exponent ("2.5e", "1e-") is
// a slip, not 6.79. Every kit reads its fields through this, so a kit never accepts it.
import type { Outcome } from './errors';
import { evaluate } from './general';
import type { EvaluateOptions } from './general';

/** A number right before an "e" that starts an exponent but has no digits after it: 2.5e, 1e-, 3E+, 2e*4. */
const DANGLING = /(?:^|[^A-Za-z_\d.])(?:\d+\.?\d*|\.\d+)([eE])(?:[+-](?!\d)|(?![+\-\d\w.]))/;

/** Where a half-typed exponent starts in the text, or -1 when there is none. */
export function danglingExponent(text: string): number {
  const match = DANGLING.exec(text);
  return match ? match.index + match[0].lastIndexOf(match[1]!) : -1;
}

/** `evaluate`, except that a half-typed exponent is an error (unexpected end, where the exponent's digits go). */
export function evaluateTyped(source: string, options: EvaluateOptions = {}): Outcome<number> {
  const at = danglingExponent(source);
  if (at >= 0) {
    return { ok: false, error: { code: 'unexpected-end', position: source.length, length: 0, expected: 'exponent' } };
  }
  return evaluate(source, options);
}
