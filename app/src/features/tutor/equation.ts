// The worked steps of a linear equation in one letter, such as 2x + 3 = 7, for the rules tutor. Each side is read by
// the calculus reader and worked out at a few points, so any way of writing a linear equation works: the next line
// gathers the letter on one side (2x = 4), and the line after it is the answer (x = 2). Anything else gives null.
import { freeNames } from '../../core/expr';
import { mathKit } from './kit';

export interface EquationSteps {
  letter: string;
  /** 'collect' when the letter still has numbers beside it, 'divide' when only its multiplier is left, 'solved'. */
  stage: 'collect' | 'divide' | 'solved';
  /** The next line, as plain text. The answer itself when the stage is 'divide'. */
  next: string;
  /** The letter's multiplier once the terms are gathered, as text. */
  coefficient: string;
  /** The answer, such as x = 2. */
  answer: string;
  /** Every line from this one to the answer. */
  lines: string[];
}

const CONSTANTS = new Set(['pi', 'e', 'tau', 'phi']);
const CLOSE = 1e-9;

/** A number as a student writes it: a whole number, a small fraction, or a short decimal. */
export function numberText(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const whole = Math.round(value);
  if (Math.abs(value - whole) < CLOSE) return String(whole === 0 ? 0 : whole);
  for (let below = 2; below <= 12; below++) {
    const top = Math.round(value * below);
    if (Math.abs(value * below - top) < CLOSE * below) return `${top}/${below}`;
  }
  return String(Number(value.toFixed(4)));
}

/** The letter's multiplier as it is written in front of the letter: 2x, x, -x, 1/2x. */
function times(coefficient: number, letter: string): string {
  if (Math.abs(coefficient - 1) < CLOSE) return letter;
  if (Math.abs(coefficient + 1) < CLOSE) return `-${letter}`;
  const text = numberText(coefficient);
  return text.includes('/') ? `(${text})${letter}` : `${text}${letter}`;
}

type Line = (x: number) => number;

function side(text: string, letter: { name: string | null }): Line | null {
  const kit = mathKit();
  if (!kit) return null;
  try {
    const node = kit.expression(text, 'text');
    const names = freeNames(node).filter((name) => !CONSTANTS.has(name));
    for (const name of names) {
      if (letter.name !== null && letter.name !== name) return null;
      letter.name = name;
    }
    const run = kit.evaluator(node);
    return (x) => run(letter.name ? { [letter.name]: x } : {});
  } catch {
    return null;
  }
}

/** Slope and value at zero, when `f` is a straight line (checked at four points); otherwise null. */
function straight(f: Line): { slope: number; at0: number } | null {
  const [a, b, c, d] = [f(0), f(1), f(2), f(-1.5)];
  if (![a, b, c, d].every(Number.isFinite)) return null;
  const slope = b - a;
  const scale = 1 + Math.abs(a) + Math.abs(slope);
  if (Math.abs(c - (a + 2 * slope)) > CLOSE * scale || Math.abs(d - (a - 1.5 * slope)) > CLOSE * scale) return null;
  return { slope, at0: a };
}

/** The steps from a linear equation in one letter to its answer, or null when the line is not one. */
export function equationSteps(raw: string): EquationSteps | null {
  const text = raw.trim();
  if (text.length === 0 || text.length > 300 || /[<>≤≥≠]/.test(text)) return null;
  const parts = text.split('=');
  if (parts.length !== 2) return null;
  const letter = { name: null as string | null };
  const left = side(parts[0] ?? '', letter);
  const right = side(parts[1] ?? '', letter);
  if (!left || !right || letter.name === null || letter.name.length > 2) return null;
  const whole = straight((x) => left(x) - right(x));
  const l = straight(left);
  const r = straight(right);
  if (!whole || !l || !r || Math.abs(whole.slope) < 1e-12) return null;
  const name = letter.name;
  const value = -whole.at0 / whole.slope;
  const answer = `${name} = ${numberText(value)}`;
  const coefficient = numberText(whole.slope);
  const bare = text.replace(/\s+/g, '');
  if (bare === answer.replace(/\s+/g, '') || bare === `${numberText(value)}=${name}`) {
    return { letter: name, stage: 'solved', next: answer, coefficient, answer, lines: [answer] };
  }
  const zero = (n: number) => Math.abs(n) < CLOSE;
  const gathered = (zero(r.slope) && zero(l.at0)) || (zero(l.slope) && zero(r.at0));
  if (gathered) {
    const by = zero(r.slope) ? l.slope : r.slope;
    return { letter: name, stage: 'divide', next: answer, coefficient: numberText(by), answer, lines: [text, answer] };
  }
  const next = `${times(whole.slope, name)} = ${numberText(-whole.at0)}`;
  return { letter: name, stage: 'collect', next, coefficient, answer, lines: [text, next, answer] };
}
