// Check my work: one test per kind of step, with the expected verdicts and corrections worked out by hand.
import { describe, expect, it } from 'vitest';
import { checkSteps, latexToLine, summarize } from './index';
import type { StepResult } from './index';

const verdicts = (results: StepResult[]) => results.map((r) => r.verdict);
const at = (lines: string[], index: number) => checkSteps(lines)[index];

describe('checkSteps', () => {
  it('returns one result per line with the documented fields', () => {
    const results = checkSteps(['2x + 3 = 7', '2x = 4', 'x = 2']);
    expect(results).toHaveLength(3);
    for (const [i, r] of results.entries()) {
      expect(r.index).toBe(i);
      expect(['ok', 'broken', 'unchecked']).toContain(r.verdict);
      expect(typeof r.reason).toBe('string');
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    }
    expect(verdicts(results)).toEqual(['ok', 'ok', 'ok']);
    expect(results[0].method).toBe('given');
  });

  it('finds the sign slip when a term moves across the equals sign, and suggests the line', () => {
    // 2x + 3 = 7 gives 2x = 4; writing 2x = 7 + 3 kept the sign of 3.
    const r = at(['2x + 3 = 7', '2x = 7 + 3', 'x = 5'], 1);
    expect(r.verdict).toBe('broken');
    expect(r.reason).toBe('signMoved');
    expect(r.params.term).toBe('3');
    expect(r.suggestion).toBe('2x = 4');
  });

  it('marks the steps after the first broken one that follow from it', () => {
    const results = checkSteps(['2x + 3 = 7', '2x = 10', 'x = 5']);
    expect(verdicts(results)).toEqual(['ok', 'broken', 'ok']);
    expect(results[2].reason).toBe('followsPrevious');
    expect(summarize(results)).toEqual({ ok: 1, broken: 1, unchecked: 0, firstBroken: 1 });
  });

  it('suggests the right value for a wrong answer line', () => {
    // 5x = 15 means x = 3, not x = 5.
    const r = at(['5x = 15', 'x = 5'], 1);
    expect(r.verdict).toBe('broken');
    expect(r.suggestion).toBe('x = 3');
  });
});

describe('checkSteps on expressions and equations', () => {
  it('checks expansions symbolically', () => {
    expect(at(['(x + 3)^2', '= x^2 + 6x + 9'], 1)).toMatchObject({ verdict: 'ok', method: 'symbolic' });
    const wrong = at(['(x + 3)^2', '= x^2 + 9'], 1);
    expect(wrong.verdict).toBe('broken');
    expect(wrong.suggestion).toBe('= x^2 + 6x + 9');
  });

  it('says when a form agrees only for some values instead of calling it wrong', () => {
    expect(at(['sqrt(x^2)', '= x'], 1)).toMatchObject({ verdict: 'unchecked', reason: 'someValues' });
  });

  it('says when a step loses a solution instead of calling it wrong', () => {
    // x^2 = 16 has x = 4 and x = -4.
    const r = at(['x^2 = 16', 'x = 4'], 1);
    expect(r).toMatchObject({ verdict: 'unchecked', reason: 'lostSolutions' });
    expect(r.params.at).toBe('x = -4');
  });

  it('accepts a step that only adds solutions, as squaring both sides does', () => {
    expect(at(['sqrt(x) = x - 2', 'x = (x - 2)^2'], 1)).toMatchObject({ verdict: 'ok', reason: 'addsSolutions' });
  });

  it('checks the direction of an inequality', () => {
    const r = at(['-3x > 6', 'x > -2'], 1);
    expect(r).toMatchObject({ verdict: 'broken', reason: 'inequalityFlip', suggestion: 'x < -2' });
    expect(at(['-3x > 6', 'x < -2'], 1).verdict).toBe('ok');
    expect(at(['x^2 <= 4', '-2 <= x <= 2'], 1).verdict).toBe('ok');
  });
});

describe('checkSteps on calculus', () => {
  it('checks derivatives by working them out, and gives the right one', () => {
    expect(at(['d/dx(x^3 cos(x)) = 3x^2 cos(x) - x^3 sin(x)'], 0).verdict).toBe('ok');
    const wrong = at(['d/dx(x^3 cos(x)) = -3x^2 sin(x)'], 0);
    expect(wrong).toMatchObject({ verdict: 'broken', reason: 'derivativeOff' });
    expect(wrong.suggestion).toContain('sin(x)');
    expect(verdicts(checkSteps(['f(x) = x^4', "f'(x) = 4x^3", "f'(1) = 4"]))).toEqual(['ok', 'ok', 'ok']);
  });

  it('checks antiderivatives by differentiating back, by parts and by substitution', () => {
    const parts = ['∫ x cos(x) dx', '= x sin(x) - ∫ sin(x) dx', '= x sin(x) + cos(x) + C'];
    expect(verdicts(checkSteps(parts))).toEqual(['ok', 'ok', 'ok']);
    expect(checkSteps(parts)[2].method).toBe('derivative');
    const sub = ['∫ 3x^2 e^(x^3) dx', 'let u = x^3', '= ∫ e^u du', '= e^u + C', '= e^(x^3) + C'];
    expect(verdicts(checkSteps(sub))).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    expect(at(['∫ x cos(x) dx', '= x sin(x) - ∫ sin(x) dx', '= x sin(x) - cos(x) + C'], 2)).toMatchObject({
      verdict: 'broken',
      reason: 'antiderivativeOff',
    });
  });

  it('works out definite integrals, limits, and sums', () => {
    // The integral of 2x from 1 to 3 is 9 - 1 = 8.
    expect(at(['∫_1^3 2x dx = [x^2]_1^3 = 8'], 0).verdict).toBe('ok');
    expect(at(['∫_1^3 2x dx = [x^2]_1^3 = 9'], 0)).toMatchObject({ verdict: 'broken', reason: 'valueOff' });
    expect(at(['lim_(x->0) sin(4x)/(2x) = 2'], 0).verdict).toBe('ok');
    expect(at(['lim_(x->0) sin(4x)/(2x) = 4'], 0).verdict).toBe('broken');
    expect(at(['Σ_(n=1)^(4) n^3 = 100'], 0).verdict).toBe('ok');
  });
});

describe('checkSteps on systems, matrices, and units', () => {
  it('solves a linear system and checks each line at its solution', () => {
    const lines = ['2x + y = 7, x - y = 2', '3x = 9', 'x = 3', 'y = 1'];
    expect(verdicts(checkSteps(lines))).toEqual(['ok', 'ok', 'ok', 'ok']);
    const wrong = at(['2x + y = 7, x - y = 2', '3x = 9', 'x = 3', 'y = 2'], 3);
    expect(wrong).toMatchObject({ verdict: 'broken', reason: 'notAtSolution', suggestion: 'y = 1' });
  });

  it('works out matrices and vectors entry by entry', () => {
    // [[1, 1], [0, 1]] [[1, 0], [2, 1]] = [[3, 1], [2, 1]].
    expect(at(['[[1, 1], [0, 1]] * [[1, 0], [2, 1]] = [[3, 1], [2, 1]]'], 0).verdict).toBe('ok');
    const wrong = at(['[[1, 1], [0, 1]] * [[1, 0], [2, 1]] = [[3, 1], [2, 2]]'], 0);
    expect(wrong).toMatchObject({
      verdict: 'broken',
      reason: 'matrixEntry',
      params: { row: '2', column: '2', value: '1' },
    });
    expect(at(['[1, 2] · [3, 4] = 11'], 0).verdict).toBe('ok');
    expect(at(['[2, 0, 0] × [0, 3, 0] = [0, 0, 6]'], 0).verdict).toBe('ok');
    expect(at(['[[1, 2], [3, 4]] + [1, 2, 3] = 0'], 0)).toMatchObject({ verdict: 'broken', reason: 'matrixShape' });
  });

  it('checks units: kinds, conversions, and sums that cannot be added', () => {
    expect(at(['120 km / (2 h) = 60 km/h'], 0).verdict).toBe('ok');
    // 1 km/h is 1000 m / 3600 s, so 36 km/h is 10 m/s.
    expect(at(['36 km/h = 10 m/s'], 0).verdict).toBe('ok');
    expect(at(['36 km/h = 100 m/s'], 0)).toMatchObject({
      verdict: 'broken',
      reason: 'unitValue',
      suggestion: '= 10 m/s',
    });
    expect(at(['2 kg = 2 km'], 0)).toMatchObject({ verdict: 'broken', reason: 'unitKind' });
    expect(at(['3 km + 2 kg = 5 km'], 0)).toMatchObject({ verdict: 'broken', reason: 'unitsAdd' });
  });
});

describe('checkSteps on any input', () => {
  it('reads LaTeX lines from an equation or handwriting', () => {
    const lines = [
      { text: '\\frac{d}{dx}\\left(x^{2}\\right) = 2x', format: 'latex' as const },
      { text: '\\int_{0}^{2} x \\, dx = 2', format: 'latex' as const },
      { text: '3x \\leq 6', format: 'latex' as const },
      { text: 'x \\leq 2', format: 'latex' as const },
    ];
    expect(verdicts(checkSteps(lines))).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(latexToLine('\\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}')).toBe('[[1, 2], [3, 4]]');
    expect(latexToLine('\\sqrt{x}+\\frac{1}{2}')).toBe('sqrt(x)+((1)/(2))');
  });

  it('leaves lines it cannot read unchecked, and checks the next line against the last one it read', () => {
    const results = checkSteps(['4x = 8', 'divide both sides by four', 'x = 2']);
    expect(verdicts(results)).toEqual(['ok', 'unchecked', 'ok']);
    expect(results[1].reason).toBe('notMath');
  });

  it('gives the same answer every time for the same seed', () => {
    const lines = ['sin(x)^2', '= (1 - cos(2x))/2', '= 1 - cos(x)^2'];
    expect(checkSteps(lines, { seed: 7 })).toEqual(checkSteps(lines, { seed: 7 }));
    expect(verdicts(checkSteps(lines, { seed: 7 }))).toEqual(verdicts(checkSteps(lines, { seed: 99 })));
  });

  it('never throws or hangs on hostile input', () => {
    const hostile = [
      '',
      '((((((((((((((((((((((((((((((x',
      '='.repeat(5000),
      `${'('.repeat(3000)}1${')'.repeat(3000)}`,
      '∫∫∫∫ dx dx',
      'lim lim lim',
      '[[1, 2], [3]] = 1',
      '['.repeat(500),
      'x^x^x^x^x^x^x^x^x^x^x^x = 1',
      '1/0 = 1/0',
      'd/dx(',
      'Σ_(n=1)^(1e300) n = 1',
      '<script>alert(1)</script>',
      '\u0000‮ x = 1',
      'x'.repeat(10_000),
    ];
    const began = Date.now();
    const results = checkSteps(hostile, { budgetMs: 3000 });
    expect(results).toHaveLength(hostile.length);
    expect(Date.now() - began).toBeLessThan(10_000);
    expect(
      checkSteps(
        Array.from({ length: 300 }, () => 'x = 1'),
        { maxLines: 10 },
      )[250].reason,
    ).toBe('tooLong');
  });
});

// Shapes from real homework pages. The expected verdicts are worked out by hand: each problem below is solved in the
// comment beside it, independently of the checker.
describe('checkSteps on a page of homework', () => {
  it('checks each problem on its own, after a blank line, a number, or a title', () => {
    // 2x + 3 = 7 gives x = 2; 3x - 1 = 8 gives x = 3. Both are right.
    const second = ['3x - 1 = 8', '3x = 9', 'x = 3'];
    const first = ['2x + 3 = 7', '2x = 4', 'x = 2'];
    for (const between of ['', 'Problem 2']) {
      expect(verdicts(checkSteps([...first, between, ...second]))).toEqual(Array(7).fill('ok'));
    }
    expect(verdicts(checkSteps(['1) 2x + 3 = 7', 'x = 2', '2) 3x - 1 = 8', 'x = 3']))).toEqual(Array(4).fill('ok'));
    expect(verdicts(checkSteps(['2x + 3 = 7', 'x = 2', '3y = 9']))).toEqual(['ok', 'ok', 'ok']);
    // A slip in the second problem is still found: 3x = 9 gives x = 3, not 4.
    expect(checkSteps([...first, '', '3x - 1 = 8', '3x = 9', 'x = 4'])[6].verdict).toBe('broken');
  });

  it('reads a title with digits as words, not as letters multiplied together', () => {
    expect(at(['x = 2', 'Problem 2'], 1)).toMatchObject({ verdict: 'ok', method: 'given' });
    expect(at(['x = 2', 'Now try problem 2'], 1)).toMatchObject({ verdict: 'unchecked', reason: 'notMath' });
  });

  it('checks a system written one equation to a line against all of them', () => {
    // y = 3x and x + y = 8 give x = 2, y = 6.
    expect(verdicts(checkSteps(['y = 3x', 'x + y = 8', 'x + 3x = 8', '4x = 8', 'x = 2', 'y = 6']))).toEqual(
      Array(6).fill('ok'),
    );
    // 2x + y = 7 and x - y = 2 add to 3x = 9: x = 3, y = 1.
    const elimination = checkSteps(['2x + y = 7', 'x - y = 2', '3x = 9', 'x = 3', 'y = 1']);
    expect(verdicts(elimination)).toEqual(Array(5).fill('ok'));
    expect(elimination[1].reason).toBe('systemEquation');
    expect(verdicts(checkSteps(['x = 2', 'y = x + 1', 'y = 3']))).toEqual(['ok', 'ok', 'ok']);
    // y = 7 is wrong: x = 3 and 2x + y = 7 give y = 1.
    expect(at(['2x + y = 7', 'x - y = 2', '3x = 9', 'x = 3', 'y = 7'], 4)).toMatchObject({
      verdict: 'broken',
      suggestion: 'y = 1',
    });
    // Moving y across the equals sign without changing its sign is still a slip.
    expect(at(['2x + y = 7', '2x = 7 + y'], 1)).toMatchObject({ verdict: 'broken', reason: 'signMoved' });
  });

  it('works out dy/dx and y′ from y = ... on the line before', () => {
    // y = x^2 gives dy/dx = 2x; y = x^3 gives y' = 3x^2.
    expect(at(['y = x^2', 'dy/dx = 2x'], 1).verdict).toBe('ok');
    expect(at(['y = x^3', "y' = 3x^2"], 1).verdict).toBe('ok');
    expect(at(['y = x^2', latexToLine('\\frac{dy}{dx} = 2x')], 1).verdict).toBe('ok');
    expect(at(['y = x^2', 'dy/dx = 3x'], 1)).toMatchObject({ verdict: 'broken', suggestion: '= 2x' });
    expect(at(['dy/dx = 2x'], 0)).toMatchObject({ verdict: 'unchecked' });
  });

  it('takes a rounded decimal as the value it rounds', () => {
    // sqrt(2) = 1.41421..., 2 pi = 6.28318..., 1/3 = 0.333..., 7/3 = 2.333...
    expect(at(['sqrt(2)', '= 1.414'], 1)).toMatchObject({ verdict: 'ok', reason: 'rounded', params: { places: '3' } });
    expect(at(['2 pi', '= 6.28'], 1)).toMatchObject({ verdict: 'ok', reason: 'rounded' });
    expect(at(['x = 1/3 = 0.33'], 0)).toMatchObject({ verdict: 'ok', reason: 'rounded' });
    expect(at(['x = 7/3', 'x ≈ 2.33'], 1)).toMatchObject({ verdict: 'ok', reason: 'rounded' });
    // 1.42 is not sqrt(2) to two places (that is 1.41).
    expect(at(['sqrt(2)', '= 1.42'], 1).verdict).toBe('broken');
  });

  it('drops notes in brackets and reads "at x = 2" as the point', () => {
    expect(verdicts(checkSteps(['2x = 6 (divide by 2)', 'x = 3']))).toEqual(['ok', 'ok']);
    // d/dx(x^3) = 3x^2, which is 12 at x = 2.
    expect(verdicts(checkSteps(['d/dx(x^3) at x = 2', '= 12']))).toEqual(['ok', 'ok']);
    expect(at(['d/dx(x^3) at x = 2', '= 4'], 1)).toMatchObject({ verdict: 'broken', suggestion: '= 12' });
  });

  it('notes a missing + C without calling the step wrong, unless a later line adds it', () => {
    expect(at(['∫ 2x dx', '= x^2'], 1)).toMatchObject({
      verdict: 'ok',
      reason: 'missingConstant',
      suggestion: '= x^2 + C',
    });
    expect(at(['∫ 3x^2 dx = x^3'], 0)).toMatchObject({ verdict: 'ok', reason: 'missingConstant' });
    expect(at(['∫ 2x dx', '= x^2', '= x^2 + C'], 1).reason).toBe('antiderivative');
    expect(at(['∫ 2x dx', '= x^2 + C'], 1).reason).toBe('antiderivative');
  });

  it('reads \\sin^{2} x and \\sin x as handwriting and MathLive write them', () => {
    expect(latexToLine('\\sin^{2}x+\\cos^{2}x=1')).toBe('sin(x)^(2) + cos(x)^(2) =1');
    expect(latexToLine('\\sin x')).toBe('sin(x)');
    expect(latexToLine('\\ln x^{2}')).toBe('ln(x^(2))');
    expect(checkSteps([{ text: '\\sin^{2}x+\\cos^{2}x=1', format: 'latex' }])[0].verdict).toBe('ok');
  });

  it('reads one-letter units after a number and a space', () => {
    expect(at(['5 m + 3 s = 8 m'], 0)).toMatchObject({ verdict: 'broken', reason: 'unitsAdd' });
    expect(at(['2 m * 3 m = 6 m'], 0)).toMatchObject({ verdict: 'broken', reason: 'unitKind' });
    // 5m = 20 is algebra: m = 4.
    expect(verdicts(checkSteps(['5m = 20', 'm = 4']))).toEqual(['ok', 'ok']);
  });

  it('reads a mixed number as one number', () => {
    expect(at(['1 1/2 + 1/2 = 2'], 0).verdict).toBe('ok');
  });

  it('never throws for a lone string or nothing, and gives no verdict on overflow', () => {
    expect(checkSteps('x = 1' as never)).toHaveLength(1);
    expect(checkSteps(null as never)).toEqual([]);
    expect(at(['0^0 = 1', 'x^99999999'], 1).verdict).not.toBe('broken');
    expect(at(['0^0 = 1', '= x^99999999'], 1).verdict).toBe('unchecked');
  });
});

describe('checkSteps on how students finish and check an answer', () => {
  const reasons = (results: StepResult[]) => results.map((r) => `${r.verdict} ${r.reason}`);

  it('takes roots listed one to a line as the solutions of the equation above them', () => {
    // x^2 - 5x + 6 = (x - 2)(x - 3), so the solutions are 2 and 3; x^2 = 16 has 4 and -4; x^2 + 2x - 3 = 0 has 1, -3.
    expect(reasons(checkSteps(['x^2 - 5x + 6 = 0', '(x-2)(x-3) = 0', 'x = 2', 'x = 3']))).toEqual([
      'ok start',
      'ok sameSolutions',
      'ok oneRoot',
      'ok oneRoot',
    ]);
    expect(verdicts(checkSteps(['x^2 = 16', 'x = 4', 'x = -4']))).toEqual(['ok', 'ok', 'ok']);
    expect(verdicts(checkSteps(['x^2 + 2x - 3 = 0', 'x = (-2 ± 4)/2', 'x = 1', 'x = -3']))).toEqual([
      'ok',
      'ok',
      'ok',
      'ok',
    ]);
    const latex = ['x^2=9', 'x=3', 'x=-3'].map((text) => ({ text, format: 'latex' as const }));
    expect(verdicts(checkSteps(latex))).toEqual(['ok', 'ok', 'ok']);
  });

  it('leaves a partial list unchecked and calls a value that solves nothing broken', () => {
    // Only x = 4 of x^2 = 16: the line lost x = -4, which is not a slip on its own.
    expect(reasons(checkSteps(['x^2 = 16', 'x = 4']))[1]).toBe('unchecked lostSolutions');
    // 4 solves neither x^2 - 5x + 6 = 0 (16 - 20 + 6 = 2) nor x = 2.
    const r = at(['x^2 - 5x + 6 = 0', 'x = 2', 'x = 4'], 2);
    expect(r.verdict).toBe('broken');
    expect(r.suggestion).toBe('x = 2 or x = 3');
  });

  it('checks the answer put back in as a new chain of numbers', () => {
    // 3(5) - 4 = 15 - 4 = 11, after x = 5: not a step on from 5.
    expect(verdicts(checkSteps(['x = 5', '3(5) - 4', '= 15 - 4', '= 11']))).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(verdicts(checkSteps(['2x = 6', 'x = 3', '2(3)']))).toEqual(['ok', 'ok', 'ok']);
    expect(verdicts(checkSteps(['x = 5', '(2+3)(4+5)', '= 45']))).toEqual(['ok', 'ok', 'ok']);
  });

  it('puts in a letter fixed above when a chain uses it', () => {
    // With x = 3: 2x is 6, x + 2 is 5, and 7 is not 2x.
    const r = at(['x = 3', '2x', '= 6'], 2);
    expect([r.verdict, r.reason, r.params.at]).toEqual(['ok', 'knownValue', 'x = 3']);
    expect(at(['x = 3', 'y = 2x = 6'], 1).verdict).toBe('ok');
    expect(at(['x = 3', 'x + 2', '= 5'], 2).verdict).toBe('ok');
    const wrong = at(['x = 3', '2x', '= 7'], 2);
    expect([wrong.verdict, wrong.suggestion]).toEqual(['broken', '= 6']);
    // A new problem forgets the letter: x^2 - 1 against (x - 1)^2 differs at x = 3 too, and as expressions.
    expect(at(['x = 3', '', 'x^2 - 1', '= (x - 1)^2'], 3).verdict).toBe('broken');
  });

  it('reads LHS and RHS, let, and letters named equal as labels, not letters multiplied', () => {
    // 3(5) - 4 = 11.
    expect(reasons(checkSteps(['LHS = 3(5) - 4 = 11 = RHS']))).toEqual(['ok sameValue']);
    expect(verdicts(checkSteps(['3x - 4 = 11', 'x = 5', 'LHS = 3(5) - 4 = 11 = RHS']))).toEqual(['ok', 'ok', 'ok']);
    expect(at(['LHS = 3(5) - 4 = 12 = RHS'], 0).verdict).toBe('broken');
    expect(at(['let a = b = c'], 0).verdict).toBe('ok');
    expect(at(['x = y = z = w'], 0).verdict).toBe('ok');
    expect(at(['LHS = RHS'], 0).verdict).toBe('ok');
  });

  it('suggests one + C for a wrong antiderivative', () => {
    // The antiderivative of x^3 is x^4/4 + C.
    expect(at(['∫ x^3 dx = x^4 + C'], 0).suggestion).toBe('= x^4/4 + C');
    expect(at(['∫ x^3 dx = x^4'], 0).suggestion).toBe('= x^4/4 + C');
  });

  it('does not say "follows from your previous line" for an ordinary right step', () => {
    expect(at(['x = 5', 'x = 5.0'], 1).reason).toBe('sameSolutions');
    expect(at(['x^2 - 1', '= (x-1)(x+1)'], 1).reason).toBe('equivalent');
  });

  it('reads answer marks, vulgar fractions, percent, and listed answers', () => {
    expect(verdicts(checkSteps(['½x = 4', 'x = 8']))).toEqual(['ok', 'ok']);
    expect(at(['½x = 4', 'x = 2'], 1).verdict).toBe('broken');
    expect(at(['2x = 10', 'x = 5 ✓'], 1).reason).toBe('sameSolutions');
    expect(at(['2x = 10', 'ans: x = 5'], 1).reason).toBe('sameSolutions');
    expect(at(['x^2 - 5x + 6 = 0', 'x = 2, 3'], 1).reason).toBe('sameSolutions');
    expect(at(['x^2 - 5x + 6 = 0', 'x ∈ {2, 3}'], 1).reason).toBe('sameSolutions');
    // 25% of 80 is 20, not 25.
    expect(at(['25% of 80 = 20'], 0).verdict).toBe('ok');
    expect(at(['25% of 80 = 25'], 0).verdict).toBe('broken');
  });

  it('uses the default limits when the options are not positive numbers', () => {
    for (const options of [{ maxLines: -1 }, { maxLines: Number.NaN }, { budgetMs: 'x' as never }, { maxLines: 0 }]) {
      expect(verdicts(checkSteps(['2x = 4', 'x = 2'], options))).toEqual(['ok', 'ok']);
    }
    expect(checkSteps(['2x = 4', 'x = 2'], { maxLines: 1 })[1].reason).toBe('tooLong');
  });
});
