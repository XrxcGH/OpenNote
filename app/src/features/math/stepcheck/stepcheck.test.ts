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
