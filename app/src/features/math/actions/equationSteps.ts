// Steps for an equation in one letter that is linear or quadratic, such as 2x + 3 = 11: move everything to one side,
// then isolate the letter or use the quadratic formula. Anything else is left to the other step tools.
import { fractions, freeNames } from '../../../core/expr';
import type { Node, Rational } from '../../../core/expr';
import { expression } from '../calculus/read';
import type { Step } from '../calculus';
import { Unsupported } from './convert';
import { polynomial } from './cancel';
import type { StepsResult } from './steps';

const CONSTANTS = new Set(['pi', 'e', 'tau', 'phi']);
const ZERO = fractions.ZERO_RATIONAL;

/** A number as LaTeX: a whole number or a small fraction. */
function num(value: Rational): string {
  const magnitude = fractions.abs(value);
  const text = fractions.isInteger(magnitude)
    ? String(magnitude.n)
    : String.raw`\frac{${String(magnitude.n)}}{${String(magnitude.d)}}`;
  return fractions.sign(value) < 0 ? `-${text}` : text;
}

/** A polynomial as LaTeX from its highest power down: 2x^{2} - 3x + 1. */
function poly(coefs: readonly Rational[], name: string): string {
  let out = '';
  for (let degree = coefs.length - 1; degree >= 0; degree -= 1) {
    const c = coefs[degree];
    if (fractions.sign(c) === 0) continue;
    const magnitude = fractions.abs(c);
    const one = fractions.compare(magnitude, fractions.ONE_RATIONAL) === 0;
    const body =
      degree === 0 ? num(magnitude) : `${one ? '' : num(magnitude)}${name}${degree > 1 ? `^{${degree}}` : ''}`;
    out += out === '' ? (fractions.sign(c) < 0 ? `-${body}` : body) : ` ${fractions.sign(c) < 0 ? '-' : '+'} ${body}`;
  }
  return out === '' ? '0' : out;
}

function sides(latex: string): [Node, Node] | null {
  const at = latex.indexOf('=');
  if (at < 0 || latex.indexOf('=', at + 1) >= 0) return null;
  try {
    return [expression(latex.slice(0, at), 'latex'), expression(latex.slice(at + 1), 'latex')];
  } catch (error) {
    if (error instanceof Unsupported) return null;
    throw error;
  }
}

/** The steps and answer for a linear or quadratic equation in one letter, or null when it is neither. */
export function equationSteps(latex: string): StepsResult | null {
  const both = sides(latex);
  if (!both) return null;
  const names = [...new Set(both.flatMap((node) => freeNames(node)).filter((n) => !CONSTANTS.has(n)))];
  if (names.length !== 1) return null;
  const [name] = names;
  const left = polynomial(both[0], name);
  const right = polynomial(both[1], name);
  if (!left || !right) return null;
  const size = Math.max(left.length, right.length);
  const p = Array.from({ length: size }, (_, i) => fractions.sub(left[i] ?? ZERO, right[i] ?? ZERO));
  while (p.length > 0 && fractions.sign(p[p.length - 1]) === 0) p.pop();
  if (p.length < 2 || p.length > 3) return null;
  const collect: Step = { rule: 'collect', latex: `${poly(p, name)} = 0` };
  if (p.length === 2) {
    const [b, a] = p;
    const rhs = fractions.neg(b);
    const answer = fractions.div(rhs, a);
    const steps: Step[] = [collect];
    if (fractions.sign(b) !== 0) steps.push({ rule: 'isolate', latex: `${poly([ZERO, a], name)} = ${num(rhs)}` });
    if (fractions.compare(a, fractions.ONE_RATIONAL) !== 0) {
      steps.push({ rule: 'divideBoth', latex: `${name} = ${num(answer)}`, note: String.raw`\div ${num(a)}` });
    }
    return { ok: true, kind: 'equation', steps, result: `${name} = ${num(answer)}` };
  }
  const [c, b, a] = p;
  const disc = fractions.sub(fractions.mul(b, b), fractions.mul(fractions.rational(4n), fractions.mul(a, c)));
  const formula: Step = {
    rule: 'quadraticFormula',
    latex: String.raw`${name} = \frac{-(${num(b)}) \pm \sqrt{(${num(b)})^{2} - 4(${num(a)})(${num(c)})}}{2(${num(a)})}`,
    note: String.raw`b^{2} - 4ac = ${num(disc)}`,
  };
  if (fractions.sign(disc) < 0) return { ok: false, reason: 'noRealSolution', steps: [collect, formula] };
  const root = fractions.rootExact(disc, 2);
  const twoA = fractions.mul(fractions.rational(2n), a);
  const values = root
    ? [
        fractions.div(fractions.sub(fractions.neg(b), root), twoA),
        fractions.div(fractions.add(fractions.neg(b), root), twoA),
      ]
    : null;
  const result = values
    ? (fractions.compare(values[0], values[1]) === 0 ? [values[0]] : values.sort(fractions.compare))
        .map((v) => `${name} = ${num(v)}`)
        .join(String.raw`,\ `)
    : (() => {
        const d = Math.sqrt(fractions.toNumber(disc));
        const base = -fractions.toNumber(b);
        const den = fractions.toNumber(twoA);
        return [(base - d) / den, (base + d) / den]
          .sort((x, y) => x - y)
          .map((v) => String.raw`${name} \approx ${Number(v.toPrecision(6))}`)
          .join(String.raw`,\ `);
      })();
  return { ok: true, kind: 'equation', steps: [collect, formula], result };
}
