// Cancels a common polynomial factor in a quotient, such as (x^2 - 9)/(x - 3) to x + 3, by exact polynomial division.
// The general simplifier only cancels factors it can see; this finds the ones hidden in a sum.
import { fractions, tryParse } from '../../../core/expr';
import type { Node, Rational } from '../../../core/expr';
import { expand, isRational, norm, TooLarge } from '../calculus/algebra';

const MAX_DEGREE = 12;

/** Coefficients by degree of a polynomial in `name` with rational coefficients, or null when it is anything else. */
export function polynomial(node: Node, name: string): Rational[] | null {
  let terms;
  try {
    terms = expand(norm(node));
  } catch (error) {
    if (error instanceof TooLarge) return null;
    throw error;
  }
  const out: Rational[] = [];
  for (const term of terms) {
    let degree = 0;
    for (const factor of term.factors) {
      if (factor.key !== name || !isRational(factor.exp) || !fractions.isInteger(factor.exp)) return null;
      degree += Number(factor.exp.n);
    }
    if (degree < 0 || degree > MAX_DEGREE) return null;
    while (out.length <= degree) out.push(fractions.ZERO_RATIONAL);
    out[degree] = fractions.add(out[degree], term.coef);
  }
  while (out.length > 0 && fractions.sign(out[out.length - 1]) === 0) out.pop();
  return out;
}

/** The quotient when `top` divides evenly by `bottom`, else null. Coefficients run from the constant term up. */
function divide(top: Rational[], bottom: Rational[]): Rational[] | null {
  const rest = [...top];
  const lead = bottom[bottom.length - 1];
  const quotient: Rational[] = Array.from(
    { length: Math.max(top.length - bottom.length + 1, 0) },
    () => fractions.ZERO_RATIONAL,
  );
  for (let i = top.length - bottom.length; i >= 0; i -= 1) {
    const q = fractions.div(rest[i + bottom.length - 1], lead);
    quotient[i] = q;
    bottom.forEach((b, j) => (rest[i + j] = fractions.sub(rest[i + j], fractions.mul(q, b))));
  }
  return rest.every((r) => fractions.sign(r) === 0) ? quotient : null;
}

/** The quotient's cancelled form as a tree, or null when `node` is not a quotient that divides evenly. */
export function cancelQuotient(node: Node, name: string): Node | null {
  if (node.type !== 'binary' || node.op !== '/') return null;
  const top = polynomial(node.left, name);
  const bottom = polynomial(node.right, name);
  if (!top || !bottom || bottom.length < 2 || top.length < bottom.length) return null;
  const quotient = divide(top, bottom);
  if (!quotient || quotient.length === 0) return null;
  const text = quotient.map((c, degree) => `(${fractions.formatFraction(c)})*${name}^${degree}`).join('+');
  const parsed = tryParse(text);
  return parsed.ok ? parsed.value : null;
}
