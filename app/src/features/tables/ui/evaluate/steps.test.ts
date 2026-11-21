import { describe, expect, it } from 'vitest';
import { createTable } from '../../engine/edit';
import { EN_US } from '../../engine/locale';
import { err } from '../../engine/values';
import type { Value } from '../../engine/values';
import { evaluatorFor } from '../formulaBar/page';
import { evaluateStep, firstStep, valueText } from './steps';
import type { Evaluator, Step } from './steps';

/** A stand-in for the engine: A1 is 4, B1 is 6, and each part as typed, worked by hand. */
const ANSWERS: Record<string, Value> = {
  A1: 4,
  B1: 6,
  '(A1+B1)': 10,
  '(A1+B1)*2': 20,
  'SUM(A1:B1,1)': 11,
  'SUM(A1:B1,1)/0': err('DIV0'),
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
    expect([step.text, step.next]).toEqual(['#DIV/0!', null]);
  });

  it('writes values as a formula would', () => {
    expect(valueText('say "hi"')).toBe('"say ""hi"""');
    expect(valueText(true)).toBe('TRUE');
    expect(valueText({ kind: 'array', rows: 2, cols: 2, data: [1, 2, 3, 4] })).toBe('{1,2;3,4}');
  });

  // The real engine on a table whose cell A1 is empty and B1 holds 7. The formula sits in C2 (data row 1, column 2).
  const COLUMNS = ['A', 'B', 'C'].map((name) => ({ name, type: 'number' as const }));
  const table = createTable(
    COLUMNS,
    [
      ['', '7', ''],
      ['', '', ''],
    ],
    EN_US,
    { today: () => 45000 },
    1,
  );
  const engine: Evaluator = evaluatorFor({ raws: [table], own: 0, names: [''] }, 2, 1);
  const finish = (formula: string): Step => {
    let step = firstStep(formula);
    for (let i = 0; step.next && i < 20; i += 1) step = evaluateStep(step, engine);
    return step;
  };

  // Answers worked by hand from the function definitions. A1 is empty. B1 and B2 are references.
  it.each([
    ['IF(A1="","empty","full")', '"empty"'],
    ['ISBLANK(A1)', 'TRUE'],
    ['ROW(B2)', '2'],
    ['ISREF(B1)', 'TRUE'],
  ])('steps %s to the value the cell shows, %s', (formula, answer) => {
    expect(finish(formula).text).toBe(answer);
  });

  it('keeps an empty cell empty and leaves references given to ROW as typed', () => {
    const step = evaluateStep(firstStep('IF(A1="","empty","full")'), engine);
    expect(step.text).toBe('IF(A1="","empty","full")');
    expect(step.values).toEqual([null]);
    expect(firstStep('ROW(B2)+B1').next).toEqual({ start: 0, end: 7 });
  });
});
