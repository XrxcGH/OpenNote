import { describe, expect, it } from 'vitest';
import { err } from '../../engine/values';
import type { Value } from '../../engine/values';
import { evaluateStep, firstStep, valueText } from './steps';

/** A stand-in for the engine: A1 is 4, B1 is 6, and the operations of these tests worked by hand. */
const ANSWERS: Record<string, Value> = {
  A1: 4,
  B1: 6,
  '(4+6)': 10,
  '10*2': 20,
  'SUM(A1:B1,1)': 11,
  '11/0': err('DIV0'),
};
const evaluate = (part: string): Value => {
  const answer = ANSWERS[part];
  if (answer === undefined) throw new Error(`No answer for ${part}`);
  return answer;
};

describe('Evaluate formula', () => {
  it('works a formula out inside out, one part at a time', () => {
    let step = firstStep('(A1+B1)*2');
    const seen: string[] = [step.text];
    while (step.next) {
      step = evaluateStep(step, evaluate);
      seen.push(step.text);
    }
    expect(seen).toEqual(['(A1+B1)*2', '(4+B1)*2', '(4+6)*2', '10*2', '20']);
  });

  it('keeps a range given to a function, and ends on an error', () => {
    let step = firstStep('SUM(A1:B1,1)/0');
    expect(step.text.slice(step.next!.start, step.next!.end)).toBe('SUM(A1:B1,1)');
    step = evaluateStep(step, evaluate);
    expect(step.text).toBe('11/0');
    step = evaluateStep(step, evaluate);
    expect(step).toEqual({ text: '#DIV/0!', next: null });
  });

  it('writes values as a formula would', () => {
    expect(valueText('say "hi"')).toBe('"say ""hi"""');
    expect(valueText(true)).toBe('TRUE');
    expect(valueText({ kind: 'array', rows: 2, cols: 2, data: [1, 2, 3, 4] })).toBe('{1,2;3,4}');
  });
});
