import { describe, expect, it } from 'vitest';
import { hideLast, isDone, parseProblem, revealNext, splitSteps, startPractice } from './practice';

const WORKED = `# Falling ball

## Given
A ball is dropped from rest from 20 m.

## Find
The time to reach the ground.

## Solution
1. Use $y = \\tfrac12 g t^2$ with $y = 20$ m.
2. Solve for $t$: $t = \\sqrt{2y/g}$.
3. Substitute: $t = \\sqrt{40/9.81}$.

## Answer
$t = 2.02$ s
`;

describe('reading a worked problem', () => {
  it('splits the problem, the numbered steps, and the answer', () => {
    const p = parseProblem(WORKED)!;
    expect(p.problem).toContain('# Falling ball');
    expect(p.problem).toContain('The time to reach the ground.');
    expect(p.problem).not.toContain('Use $y');
    expect(p.steps).toHaveLength(3);
    expect(p.steps[1]).toBe('Solve for $t$: $t = \\sqrt{2y/g}$.');
    expect(p.answer).toBe('$t = 2.02$ s');
  });

  it('reads Step n lines and paragraphs', () => {
    expect(splitSteps(['**Step 1:** Draw it.', 'Label the axes.', '**Step 2:** Sum forces.'])).toEqual([
      'Draw it.\nLabel the axes.',
      'Sum forces.',
    ]);
    expect(splitSteps(['First thing.', '', 'Second thing', 'continued.'])).toEqual([
      'First thing.',
      'Second thing\ncontinued.',
    ]);
  });

  it('finds a numbered list without a Solution heading', () => {
    const p = parseProblem('Find x.\n\n1. Add 3.\n2. Divide by 2.\n\nAnswer: x = 4');
    expect(p?.steps).toEqual(['Add 3.', 'Divide by 2.']);
    expect(p?.answer).toBe('x = 4');
  });

  it('returns null for a page with no steps', () => {
    expect(parseProblem('Just notes.\n\n- one item')).toBeNull();
    expect(parseProblem('## Solution\n')).toBeNull();
  });
});

describe('revealing steps', () => {
  it('starts hidden and shows one step at a time, then the answer', () => {
    let s = startPractice(2);
    expect(s).toEqual({ total: 2, shown: 0, answered: false });
    s = revealNext(s);
    expect(s.shown).toBe(1);
    s = revealNext(revealNext(s));
    expect(s).toEqual({ total: 2, shown: 2, answered: true });
    expect(isDone(s)).toBe(true);
    expect(revealNext(s)).toBe(s);
  });

  it('hides the last thing shown, and a new start is hidden again', () => {
    let s = revealNext(revealNext(revealNext(startPractice(2))));
    s = hideLast(s);
    expect(s.answered).toBe(false);
    expect(hideLast(hideLast(hideLast(s))).shown).toBe(0);
    expect(startPractice(2).shown).toBe(0);
  });
});
