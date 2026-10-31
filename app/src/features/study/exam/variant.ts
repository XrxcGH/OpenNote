// Numeric variants of a worked example (practice exams, ADR 0052). A worked problem in the notes gives its numbers,
// its steps, and a final answer. When one step holds the arithmetic that makes the answer (such as "v = 120 / 2.5 =
// 48"), the numbers it shares with the problem are the givens. A variant swaps each given for a nearby number, in the
// problem and in that arithmetic, and works the new answer out with the expression engine. Without such a step there
// is no variant, and the exam asks the problem as written.
import { evaluate } from '../../../core/expr';

export interface Variant {
  prompt: string;
  /** The new final answer, with the unit the notes' answer had. */
  answer: string;
  /** The arithmetic with the new numbers and its result, for the marking guide. */
  working: string;
  /** How far a rounded answer may be off, as a share. */
  tolerance: number;
}

/** A number standing alone: not part of a word, and a period after it ends the sentence unless a digit follows. */
const NUMBER = /(?<![\w.])-?\d+(?:\.\d+)?(?!\w|\.\d)/g;
/** A run of arithmetic: numbers, signs, and brackets, with at least one sign between numbers. */
const ARITHMETIC = /[-(]?\d[\d.\s+\-*/×÷^()]*\d\)?/g;
const MAX_TEXT = 4000;

const decimals = (text: string): number => (text.includes('.') ? text.length - text.indexOf('.') - 1 : 0);

function evaluateText(text: string): number | null {
  const outcome = evaluate(text.replace(/×/g, '*').replace(/÷/g, '/'));
  return outcome.ok && Number.isFinite(outcome.value) ? outcome.value : null;
}

/** The first number of an answer and the unit written after it: "48 km/h" gives 48 and "km/h". */
export function readAnswer(answer: string): { value: number; text: string; unit: string } | null {
  const match = /(-?\d+(?:\.\d+)?)\s*([A-Za-z°%][A-Za-z°%/^0-9·*]{0,11})?/.exec(answer.replace(/,(?=\d{3}\b)/g, ''));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? { value, text: match[1] ?? '', unit: (match[2] ?? '').trim() } : null;
}

/** The arithmetic in the steps whose value is the answer, allowing for an answer rounded to its decimals. */
function findWorking(steps: readonly string[], answer: { value: number; text: string }): string | null {
  const places = decimals(answer.text);
  for (const step of steps) {
    for (const match of step.slice(0, MAX_TEXT).matchAll(ARITHMETIC)) {
      const text = match[0].trim();
      if (!/\d\s*[-+*/×÷^]\s*[\d(]/.test(text)) continue;
      const value = evaluateText(text);
      if (value === null) continue;
      if (Math.abs(value - answer.value) <= 1e-9 * Math.max(1, Math.abs(value))) return text;
      if (Number(value.toFixed(places)) === answer.value) return text;
    }
  }
  return null;
}

/** A nearby number in the same style: a whole number stays whole, and a decimal keeps its places. */
function nearby(text: string, random: () => number): string {
  const value = Number(text);
  const places = decimals(text);
  for (let tries = 0; tries < 12; tries += 1) {
    const factor = 0.5 + Math.floor(random() * 11) / 10;
    const next = Number((value * factor).toFixed(places));
    if (next !== value && next !== 0) return next.toFixed(places);
  }
  return (value + 1).toFixed(places);
}

/** Puts new numbers in for old ones wherever they stand as whole numbers. */
function swapNumbers(text: string, swaps: ReadonlyMap<string, string>): string {
  return text.replace(NUMBER, (found) => swaps.get(found) ?? found);
}

/** A variant of the problem with new numbers, or null when the steps do not show how the answer was worked out. */
export function numericVariant(
  problem: string,
  steps: readonly string[],
  answer: string,
  random: () => number,
): Variant | null {
  const final = readAnswer(answer);
  if (!final || problem.length > MAX_TEXT) return null;
  const working = findWorking(steps, final);
  if (!working) return null;
  const inProblem = new Set(problem.match(NUMBER) ?? []);
  const givens = [...new Set(working.match(NUMBER) ?? [])].filter((number) => inProblem.has(number));
  if (givens.length === 0) return null;
  const swaps = new Map(givens.map((given) => [given, nearby(given, random)]));
  const newWorking = swapNumbers(working, swaps);
  const value = evaluateText(newWorking);
  if (value === null) return null;
  // The answer keeps the places of the notes' answer, and at least 3 significant digits.
  const places = Math.max(decimals(final.text), Math.abs(value) < 1 ? 3 : Math.abs(value) < 10 ? 2 : 0);
  const rounded = Number(value.toFixed(Math.min(places, 6)));
  const exact = Math.abs(rounded - value) <= 1e-9 * Math.max(1, Math.abs(value));
  const shown = String(rounded);
  return {
    prompt: swapNumbers(problem, swaps),
    answer: final.unit ? `${shown} ${final.unit}` : shown,
    working: `${newWorking} = ${shown}`,
    tolerance: exact ? 0.001 : 0.01,
  };
}
