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

describe('notation as students write it', () => {
  const pair = (lines: string[]) => {
    const r = checkSteps(lines)[lines.length - 1];
    return `${r.verdict}/${r.reason}`;
  };

  it("works y' out by x, not by a parameter letter that sorts first", () => {
    // d/dx(kx^2) = 2kx, d/dx(mx + c) = m, d/dx(e^(kx)) = k e^(kx).
    expect(pair(['y = kx^2', "y' = 2kx"])).toBe('ok/equivalent');
    expect(pair(['y = mx + c', "y' = m"])).toBe('ok/equivalent');
    expect(pair(['y = ax^2 + bx + c', "y' = 2ax + b"])).toBe('ok/equivalent');
    expect(pair(['y = e^(kx)', "y' = k e^(kx)"])).toBe('ok/equivalent');
    expect(pair(['y = kx^2', "y' = 3kx"])).toBe('broken/derivativeOff');
    // In t when there is no x; with two letters and neither x nor t, there is nothing to go by.
    expect(pair(['s = ut + a t^2/2', "s' = u + a t"])).toBe('ok/equivalent');
    expect(pair(['y = ab^2', "y' = 2ab"])).toBe('unchecked/cannotDecide');
  });

  it('divides by the whole fraction after ÷', () => {
    // 2/3 ÷ 4/5 = 10/12 = 5/6; 1/2 ÷ 1/4 = 2; 6 ÷ 2/3 = 9; x/2 ÷ x/4 = 2.
    expect(pair(['2/3 ÷ 4/5', '= 2/3 × 5/4'])).toBe('ok/sameValue');
    expect(pair(['2/3 ÷ 4/5', '= 5/6'])).toBe('ok/sameValue');
    expect(pair(['1/2 ÷ 1/4', '= 2'])).toBe('ok/sameValue');
    expect(pair(['6 ÷ 2/3', '= 9'])).toBe('ok/sameValue');
    expect(pair(['x/2 ÷ x/4', '= 2'])).toBe('ok/equivalent');
    // 12 ÷ 3 × 2 is still (12 ÷ 3) × 2 = 8.
    expect(pair(['12 ÷ 3 × 2', '= 8'])).toBe('ok/sameValue');
    const wrong = checkSteps(['1/2 ÷ 1/4', '= 3'])[1];
    expect([wrong.verdict, wrong.suggestion]).toEqual(['broken', '= 2']);
  });

  it('keeps values given together or on lines of their own for the check below them', () => {
    // x = 2, y = 3 gives x + y = 5 and xy = 6.
    expect(pair(['x = 2, y = 3', 'x + y', '= 5'])).toBe('ok/knownValue');
    expect(pair(['x = 2; y = 3', 'x + y', '= 5'])).toBe('ok/knownValue');
    expect(pair(['x = 2 and y = 3', 'x + y', '= 5'])).toBe('ok/knownValue');
    expect(pair(['x = 2', 'y = 3', 'x y', '= 6'])).toBe('ok/knownValue');
    expect(pair(['x = 2', 'y = 3', 'x + y', '= 6'])).toBe('broken/valueOff');
    // No x given: 2x + 3 = 7 holds at x = 2, so it is not shown as a slip.
    const open = checkSteps(['2x + 3', '= 7'])[1];
    expect([open.verdict, open.reason, open.params.at]).toEqual(['unchecked', 'someValues', 'x = 2']);
  });
});

describe('notation as students write it, part 2', () => {
  const pair = (lines: string[]) => {
    const r = checkSteps(lines)[lines.length - 1];
    return `${r.verdict}/${r.reason}`;
  };

  it('reads a slash before a product either way, and marks it broken only when both readings are wrong', () => {
    expect(pair(['1/2x', '= 1/(2x)'])).toBe('ok/equivalent');
    expect(pair(['1/2x', '= x/2'])).toBe('ok/equivalent');
    expect(pair(['2x/3y', '= 2x/(3y)'])).toBe('ok/equivalent');
    // x/2 and 1/(2x) are both not 2/x: wrong however it is read.
    expect(pair(['1/2x', '= 2/x'])).toMatch(/^broken\//);
    expect(pair(['1/2x = 3', 'x = 1/6'])).toBe('ok/sameSolutions');
    expect(pair(['1/2x = 3', 'x = 6'])).toBe('ok/sameSolutions');
    // x = 6 or x = 1/6, never 5.
    expect(pair(['1/2x = 3', 'x = 5'])).toBe('broken/differentSolutions');
    // 4x/2x is 2x^2 or 2: 12 = 2 has no solution, so the second reading cannot rule the line out.
    expect(pair(['12 = 4x/2x', '4x = 24'])).toBe('unchecked/ambiguous');
  });

  it('leaves the imaginary unit unchecked rather than trying numbers for i', () => {
    expect(pair(['i^2', '= -1'])).toMatch(/^unchecked\//);
    expect(checkSteps(['(1 + i)^2', '= 2i']).map((r) => r.reason)).toEqual(['complexNumbers', 'complexNumbers']);
    // i as a sum's index is still a number: 1 + 2 + 3 = 6.
    expect(pair(['Σ_{i=1}^{3} i', '= 6'])).toBe('ok/sameValue');
  });

  it('checks a formula in two letters rearranged for one, not as a second equation', () => {
    // y - 3 = 2x gives x = (y - 3)/2; x = y - 3/2 differs at y = 5 (x = 1 against 3.5).
    expect(pair(['y - 3 = 2x', 'x = (y - 3)/2'])).toBe('ok/sameSolutions');
    expect(checkSteps(['y - 3 = 2x', 'x = y - 3/2'])[1].verdict).toBe('broken');
    // A second equation with numbers of its own is not shown as a slip: x + y = 10 and x = y + 2.
    expect(checkSteps(['x + y = 10', 'x = y + 2'])[1].verdict).toBe('unchecked');
    expect(pair(['y = 3x', 'x + y = 8'])).toBe('ok/systemEquation');
  });
});

describe('notation as students write it, part 3', () => {
  const pair = (lines: string[]) => {
    const r = checkSteps(lines)[lines.length - 1];
    return `${r.verdict}/${r.reason}`;
  };

  it('checks f(x + h) against the definition', () => {
    // (x + h)^2 = x^2 + 2xh + h^2.
    expect(pair(['f(x) = x^2', 'f(x + h) = x^2 + 2xh + h^2'])).toMatch(/^ok\//);
    const wrong = checkSteps(['f(x) = x^2', 'f(x + h) = x^2 + h^2'])[1];
    expect([wrong.verdict, wrong.reason]).toEqual(['broken', 'notEqual']);
    // f(x) = 4 is still an equation to solve: x^2 = 4 gives x = ±2.
    expect(pair(['f(x) = x^2', 'f(x) = 4', 'x = ±2'])).toBe('ok/sameSolutions');
  });

  it('does not tick a solution that an earlier line divides by zero at', () => {
    // (x^2 - 1)/(x - 1) has no value at x = 1, so x = 1 is no solution.
    const results = checkSteps(['(x^2 - 1)/(x - 1) = 2', 'x + 1 = 2', 'x = 1']);
    expect(results.map((r) => r.reason)).toEqual(['start', 'outsideDomain', 'outsideDomain']);
    expect(results[2].params.at).toBe('x = 1');
    // (x^2 - 4)/(x - 2) = 5 gives x = 3, which the first line allows.
    expect(checkSteps(['(x^2 - 4)/(x - 2) = 5', 'x + 2 = 5', 'x = 3']).map((r) => r.verdict)).toEqual([
      'ok',
      'ok',
      'ok',
    ]);
    // x/(x - 2) = 2/(x - 2) has no solution: x = 2 divides by zero there.
    expect(pair(['x/(x - 2) = 2/(x - 2)', 'x = 2'])).toMatch(/^unchecked\//);
  });

  it('accepts decimal working rounded to a whole number, and suggests a decimal', () => {
    // 9.81 × 2 = 19.62.
    expect(pair(['9.81 × 2', '= 20'])).toBe('ok/rounded');
    expect(pair(['19.62', '≈ 20'])).toBe('ok/rounded');
    const wrong = checkSteps(['9.81 × 2', '= 30'])[1];
    expect([wrong.verdict, wrong.suggestion]).toEqual(['broken', '= 19.62']);
    // 7/2 = 3.5: no decimals in the working, so 3 is a slip.
    expect(pair(['7/2', '= 3'])).toBe('broken/valueOff');
  });
});

describe('notation as students write it, part 4', () => {
  const pair = (lines: string[]) => {
    const r = checkSteps(lines)[lines.length - 1];
    return `${r.verdict}/${r.reason}`;
  };

  it('reads vectors as (a, b, c) and ⟨a, b⟩, det without brackets, and unicode fractions', () => {
    // 1·4 + 2·(-5) + 3·6 = 12; i × j = k; ⟨1, 2⟩ + ⟨3, 4⟩ = ⟨4, 6⟩; 2·3 - 1·5 = 1; 1/2 + 1/3 = 5/6.
    expect(pair(['(1, 2, 3) · (4, -5, 6)', '= 12'])).toBe('ok/sameValue');
    expect(pair(['(1, 2, 3) · (4, -5, 6)', '= 32'])).toBe('broken/valueOff');
    expect(pair(['(1, 0, 0) × (0, 1, 0)', '= (0, 0, 1)'])).toBe('ok/sameMatrix');
    expect(pair(['⟨1,2⟩ + ⟨3,4⟩', '= ⟨4,6⟩'])).toBe('ok/sameMatrix');
    expect(pair(['⟨1, 2⟩ + ⟨3, 4⟩', '= ⟨4, 6⟩'])).toBe('ok/sameMatrix');
    expect(pair(['det [[2, 1], [5, 3]]', '= 1'])).toBe('ok/sameValue');
    expect(pair(['½ + ⅓', '= ⅚'])).toBe('ok/sameValue');
    // A lone pair stays a point or an interval: nothing is read as a vector.
    expect(checkSteps(['C(5, 2) = 10'])[0].verdict).not.toBe('broken');
  });

  it('checks a sum to a letter against a formula', () => {
    // 1 + 2 + ... + n = n(n + 1)/2; 1 + 4 + ... + n^2 = n(n + 1)(2n + 1)/6; at n = 3, 14, not 3^3 = 27.
    expect(checkSteps(['Σ_{k=1}^{n} k = n(n+1)/2'])[0].verdict).toBe('ok');
    expect(checkSteps(['Σ_(k=1)^(n) k^2 = n(n + 1)(2n + 1)/6'])[0].verdict).toBe('ok');
    expect(checkSteps(['Σ_(k=1)^(n) k^2 = n^3'])[0].verdict).toBe('broken');
    // 2^k is no polynomial: left unchecked.
    expect(checkSteps(['Σ_(k=0)^(n) 2^k = 2^(n+1) - 1'])[0].verdict).toBe('unchecked');
  });

  it('checks steps joined by arrows on one line', () => {
    expect(checkSteps(['2x + 3 = 7 → 2x = 4 → x = 2'])[0].verdict).toBe('ok');
    expect(checkSteps(['3x - 1 = 8 ⇒ 3x = 9 ⇒ x = 3'])[0].verdict).toBe('ok');
    expect(checkSteps(['2x + 3 = 7 -> 2x = 4 so x = 2'])[0].verdict).toBe('ok');
    const wrong = checkSteps(['2x + 3 = 7 → 2x = 5'])[0];
    expect([wrong.verdict, wrong.suggestion]).toEqual(['broken', '2x = 4']);
    // A limit keeps its arrow: lim x→0 of sin(x)/x is 1.
    expect(checkSteps(['lim_(x→0) sin(x)/x = 1'])[0].verdict).not.toBe('broken');
  });
});

describe('values given for a formula, and solutions that are not real', () => {
  const last = (lines: string[]) => {
    const r = checkSteps(lines)[lines.length - 1];
    return `${r.verdict}/${r.reason}`;
  };

  it('checks the answer with the values given for the formula above', () => {
    // A = π(2)^2 = 4π; v = 0 + 2(5) = 10.
    expect(last(['A = πr^2', 'r = 2', 'A = 4π'])).toBe('ok/knownValue');
    expect(last(['A = πr^2', 'r = 2', 'A = 5π'])).toBe('broken/differentSolutions');
    expect(last(['v = u + at', 'u = 0, a = 2, t = 5', 'v = 10'])).toBe('ok/knownValue');
    expect(last(['v = u + at', 'u = 0, a = 2, t = 5', 'v = 7'])).toBe('broken/differentSolutions');
    expect(last(['v = u + at', 'v = 0 + 2 × 5'])).toBe('ok/valuesPutIn');
    expect(last(['v = u + at', 'v = 0 + 2 × 5', 'v = 10'])).toBe('ok/sameSolutions');
  });

  it('finds a formula with no real value and a solution where the line before has none', () => {
    // x^2 - 2x - 8 = 0 has x = -2 and x = 4; sqrt(4 - 32) has no real value. ln(2x) = 0 gives 2x = 1, not 0.
    expect(last(['x^2 - 2x - 8 = 0', 'x = (2 ± sqrt(4 - 32))/2'])).toBe('broken/notAtSolution');
    expect(last(['x^2 - 2x - 8 = 0', 'x = (2 ± sqrt(4 + 32))/2'])).toBe('ok/sameSolutions');
    expect(last(['ln(2x) = 0', '2x = 0'])).toBe('broken/differentSolutions');
    expect(last(['ln(2x) = 0', '2x = 1'])).toBe('ok/sameSolutions');
  });

  it('reads a bracket bound such as π, and a number times a tuple as a vector', () => {
    // [x^2] from 0 to π is π^2; [cos x] from 0 to π is -1 - 1 = -2; 3(1, 2, 3) = (3, 6, 9).
    expect(last(['[x^2]_0^π = π^2'])).toBe('ok/sameValue');
    expect(last(['[cos x]_0^π = 2'])).toBe('broken/valueOff');
    expect(last(['3(1, 2, 3) = (3, 6, 9)'])).toBe('ok/sameMatrix');
    expect(last(['3(1, 2, 3) = (3, 6, 8)'])).toBe('broken/matrixEntry');
  });
});

describe('working that sets things equal, and slips a single line shows', () => {
  const marks = (lines: string[]) => checkSteps(lines).map((r) => `${r.verdict}/${r.reason}`);
  const last = (lines: string[]) => marks(lines)[lines.length - 1];

  it('reads letters named equal to a number as a note, and keeps their value', () => {
    expect(last(['a = b = c = 2'])).toBe('ok/note');
    expect(last(['let x = y = z = 1'])).toBe('ok/note');
    expect(last(['x = y = z = w = 1'])).toBe('ok/note');
    // a = b = c = 2 gives a + b + c = 6; 7 is a slip.
    expect(last(['a = b = c = 2', 'a + b + c', '= 6'])).toBe('ok/knownValue');
    expect(last(['a = b = c = 2', 'a + b + c', '= 7'])).toBe('broken/valueOff');
    // let u = x^2 still names a substitution.
    expect(last(['let u = x^2'])).toBe('ok/substitution');
  });

  it('reads a derivative set to zero as the equation to solve', () => {
    // y = x^2: y' = 2x, and 2x = 0 gives x = 0, not 1.
    expect(marks(['y = x^2', "y' = 2x", "y' = 0", 'x = 0'])).toEqual([
      'ok/start',
      'ok/equivalent',
      'ok/start',
      'ok/sameSolutions',
    ]);
    expect(last(['y = x^2', "y' = 2x", "y' = 0", 'x = 1'])).toBe('broken/differentSolutions');
    // f'(x) = 2x - 4 = 0 gives x = 2; dy/dx = 2x - 6 = 0 gives x = 3; y'' = 6x = 0 gives x = 0.
    expect(last(['f(x) = x^2 - 4x', "f'(x) = 2x - 4", "f'(x) = 0", '2x = 4', 'x = 2'])).toBe('ok/sameSolutions');
    expect(last(['y = x^2 - 6x', 'dy/dx = 2x - 6', 'dy/dx = 0', 'x = 3'])).toBe('ok/sameSolutions');
    expect(last(['y = x^2', "y' = 2x", "set y' = 0", 'x = 0'])).toBe('ok/sameSolutions');
    expect(marks(['y = x^2', "y' = 2x = 0", 'x = 0']).slice(1)).toEqual(['ok/start', 'ok/sameSolutions']);
    expect(last(['y = x^3 - 3x', "y' = 3x^2 - 3", "y'' = 6x", "y'' = 0", 'x = 0'])).toBe('ok/sameSolutions');
    // A chain that ends in an expression is still a chain.
    expect(last(['f(x) = x^2 - 4x', "f'(x) = 2x - 4 = 2(x - 2)"])).toBe('ok/equivalent');
  });

  it('shows a function or power spread over a sum on a first line, and leaves equations to solve alone', () => {
    // At x = 1, y = 1: (1 + 1)^2 = 4 but 1 + 1 = 2.
    expect(last(['(x + y)^2 = x^2 + y^2'])).toBe('broken/notEqual');
    expect(last(['sin(a + b) = sin(a) + sin(b)'])).toBe('broken/notEqual');
    expect(last(['ln(a + b) = ln(a) + ln(b)'])).toBe('broken/notEqual');
    // 2x - 6 and 2x - 3 are 3 apart for every x.
    const never = checkSteps(['2(x - 3) = 2x - 3'])[0];
    expect([never.verdict, never.reason, never.params.offset]).toEqual(['unchecked', 'neverEqual', '3']);
    expect(last(['(x + y)^2 = x^2 + 2xy + y^2'])).toBe('ok/sampleConsistent');
    for (const equation of ['x^2 = 2x', 'x^2 + y^2 = 25', '(x + 3)^2 = x^2 + 15', 'x^(1/2) = x/2']) {
      expect(last([equation])).toBe('ok/start');
    }
  });

  it('checks the quadratic formula against the equation above it', () => {
    // x^2 - 3x + 2 = 0 has x = 1 and x = 2; (-3 ± 1)/2 gives -1 and -2.
    const lines = ['x^2 - 3x + 2 = 0', 'a = 1, b = -3, c = 2', 'x = (-3 ± sqrt(9 - 8))/2', 'x = -1 or x = -2'];
    expect(marks(lines).slice(1, 3)).toEqual(['ok/coefficients', 'broken/differentSolutions']);
    expect(checkSteps(lines)[2].suggestion).toBe('x = 1 or x = 2');
    expect(last(['x^2 - 3x + 2 = 0', 'a = 1, b = -3, c = 2', 'x = (3 ± sqrt(9 - 8))/2', 'x = 1 or x = 2'])).toBe(
      'ok/sameSolutions',
    );
    const formula = ['x^2 - 3x + 2 = 0', 'x = (-b ± sqrt(b^2 - 4ac))/(2a)', 'a = 1, b = -3, c = 2'];
    expect(last([...formula, 'x = 1 or x = 2'])).toBe('ok/sameSolutions');
    expect(last([...formula, 'x = -1 or x = -2'])).toBe('broken/differentSolutions');
  });

  it('finds a factoring that does not multiply out, and keeps a dropped solution a finding', () => {
    // (x - 3)(x - 3) = x^2 - 6x + 9, not x^2 - 9 = (x + 3)(x - 3).
    const slip = checkSteps(['x^2 - 9 = 0', '(x - 3)(x - 3) = 0'])[1];
    expect([slip.verdict, slip.reason, slip.suggestion]).toEqual(['broken', 'factoringOff', '(x + 3)(x - 3) = 0']);
    expect(last(['x^2 - 5x + 6 = 0', '2(x - 2)(x - 3) = 0'])).toBe('ok/sameSolutions');
    expect(last(['x^2 = 2x', 'x = 2'])).toBe('unchecked/lostSolutions');
    expect(last(['(x - 3)^2 = 16', 'x - 3 = 4'])).toBe('unchecked/lostSolutions');
  });

  it('checks a limit with a letter left free, and the body inside it', () => {
    // From first principles, d/dx x^2 = 2x and d/dx x^3 = 3x^2.
    const lines = ['lim_(h->0) ((x+h)^2 - x^2)/h', '= lim_(h->0) (2xh + h^2)/h', '= lim_(h->0) (2x + h)', '= 2x'];
    expect(marks(lines).every((m) => m.startsWith('ok/'))).toBe(true);
    expect(last(['lim_(h->0) ((x+h)^3 - x^3)/h', '= 3x^2'])).toBe('ok/equivalent');
    expect(last(['lim_(h->0) ((x+h)^3 - x^3)/h', '= 3x'])).toBe('broken/notEqual');
    // (2xh + h^2)/h is 2x + h, not 2x + h^2, though both limits are 2x.
    expect(marks(['lim_(h->0) ((x+h)^2 - x^2)/h', '= lim_(h->0) (2x + h^2)'])[1]).toBe('broken/limitBody');
    // sin(x + h) gives no polynomial: left unchecked.
    expect(marks(['lim_(h->0) (sin(x + h) - sin(x))/h', '= cos(x)'])[0]).toBe('unchecked/cannotEvaluate');
  });

  it('reads degrees, a value list with or, and a word naming the value', () => {
    expect(last(['cos(60°) = 1/2'])).toBe('ok/sameValue');
    expect(last(['cos(60°) = 1'])).toBe('broken/valueOff');
    expect(last(['x^2 = 4', 'x = 2 or -2'])).toBe('ok/sameSolutions');
    expect(last(['x^2 = 4', 'x = 2 or -3'])).toBe('broken/differentSolutions');
    expect(last(['slope = (5 - 1)/(3 - 1)', '= 2'])).toBe('ok/sameValue');
    expect(last(['Area = 3 × 4', '= 13'])).toBe('broken/valueOff');
    expect(last(['total cost = 5'])).toBe('unchecked/notMath');
  });
});

describe('verification gaps, round 6', () => {
  const marks = (lines: string[]) => checkSteps(lines).map((r) => `${r.verdict}/${r.reason}`);
  const last = (lines: string[]) => checkSteps(lines)[lines.length - 1];

  it('asks about a ragged matrix instead of marking it, and keeps size slips between two lines', () => {
    expect(marks(['[[1,2],[3]]'])).toEqual(['unchecked/unreadable']);
    expect(marks(['[[1,2],[3,4]]', '= [[1,2],[3]]'])[1]).toBe('unchecked/unreadable');
    expect(marks(['[[1,2],[3,4]] + [[1,2,3]]'])).toEqual(['unchecked/unreadable']);
    // A 2 by 2 matrix, then a row of three: the sizes differ.
    expect(marks(['[[1,2],[3,4]]', '= [[1,2,3]]'])[1]).toBe('broken/matrixShape');
  });

  it('reads in as inches after a number, not as the imaginary unit', () => {
    // 3 ft is 36 in, so 3 ft + 2 in is 38 in, or 38/12 = 3.1667 ft.
    expect(marks(['3 ft + 2 in', '= 38 in'])[1]).toBe('ok/sameQuantity');
    expect(marks(['2 in + 3 in', '= 5 in'])).toEqual(['ok/start', 'ok/sameQuantity']);
    expect(last(['3 ft + 2 in', '= 5 ft'])).toMatchObject({ verdict: 'broken', suggestion: '= 3.1667 ft' });
    expect(marks(['3 ft + 2 in', '= 3.17 ft'])[1]).toBe('ok/rounded');
  });

  it('marks a slip wrong under both slash readings as broken, with the fix from the 1/(ab) reading', () => {
    // (12x^3/4)x = 3x^4 and 12x^3/(4x) = 3x^2; neither is 3x^3.
    expect(last(['12x^3 / 4x', '= 3x^3'])).toMatchObject({
      verdict: 'broken',
      reason: 'notEqual',
      suggestion: '= 3x^2',
    });
  });

  it('writes a fix the way the line was written', () => {
    // [[1, 2], [3, 4]] times the column [2, 1] is the column [4, 10].
    expect(last(['[[1, 2], [3, 4]] * [[2], [1]]', '= [[4], [11]]']).suggestion).toBe('= [[4], [10]]');
    // (1, 2) + (6, 8) = (7, 10).
    expect(last(['(1, 2) + 2(3, 4)', '= (7, 11)']).suggestion).toBe('= (7, 10)');
    expect(last(['⟨1, 2⟩ + ⟨3, 4⟩', '= ⟨4, 5⟩']).suggestion).toBe('= ⟨4, 6⟩');
    // e^(2x) = 7 gives 2x = ln 7, and e^x = 5 gives x = ln(5).
    expect(last(['e^(2x) = 7', '2x = 7']).suggestion).toBe('2x = ln 7');
    expect(last(['e^x = 5', 'x = 2']).suggestion).toBe('x = ln(5)');
    // The suggested lines check as right.
    expect(marks(['e^(2x) = 7', '2x = ln 7', 'x = ln(7)/2'])).toEqual([
      'ok/start',
      'ok/sameSolutions',
      'ok/sameSolutions',
    ]);
  });

  it('never shows a malformed number or a lone differential with a check mark', () => {
    expect(marks(['x = 0.1.2', 'x = 0.1.2'])).toEqual(['unchecked/unreadable', 'unchecked/unreadable']);
    expect(marks(['dx', '= dx'])).toEqual(['unchecked/unreadable', 'unchecked/unreadable']);
    expect(marks(['2x dx'])).toEqual(['unchecked/unreadable']);
    // Still read: a derivative written with spaces, an integral, and a differential line.
    expect(marks(['y = x^2', 'dy / dx = 2x'])[1]).toBe('ok/equivalent');
    expect(marks(['∫ 2x dx', '= x^2 + C'])[1]).toBe('ok/antiderivative');
    expect(marks(['u = x^2', 'du = 2x dx'])[1]).toBe('ok/note');
  });

  it('reads log bases, binomials and mod', () => {
    // 2^3 = 8, C(5, 2) = 5·4/2 = 10, 7 = 2·3 + 1, and -7 = -3·3 + 2.
    expect(marks(['log_2 8', '= 3'])).toEqual(['ok/start', 'ok/sameValue']);
    expect(last(['log_2 8 = 4'])).toMatchObject({ verdict: 'broken', suggestion: '= 3' });
    expect(marks(['log_2 x = 3', 'x = 8'])[1]).toBe('ok/sameSolutions');
    expect(marks(['C(5, 2)', '= 10'])[1]).toBe('ok/sameValue');
    expect(last(['5C2 = 11'])).toMatchObject({ verdict: 'broken', suggestion: '= 10' });
    expect(marks(['7 mod 3', '= 1'])[1]).toBe('ok/sameValue');
    expect(marks(['-7 mod 3 = 2'])).toEqual(['ok/sameValue']);
    expect(last(['7 mod 3 = 2']).verdict).toBe('broken');
    // The minus of x - 7 is subtraction: 5 - (7 mod 3) = 4. After * the reading is unsure, so it is not read.
    expect(marks(['x = 5', 'x - 7 mod 3', '= 4'])[2]).toBe('ok/knownValue');
    expect(marks(['2 * 7 mod 3 = 2'])).toEqual(['unchecked/unreadable']);
    expect(marks(['log_2 x^3 = 6'])).toEqual(['unchecked/unreadable']);
  });
});
