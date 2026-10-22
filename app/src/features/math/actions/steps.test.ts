// The equation panel's Steps (derivatives and integrals) and Solve for systems of equations and matrices.
import { describe, expect, it } from 'vitest';
import { solveLatex } from './actions';
import { derivativeSteps, integralSteps, stepsLatex } from './steps';

const answer = (latex: string) => {
  const result = solveLatex(latex);
  return result.ok
    ? result.latex
        .split(String.raw`\quad\Rightarrow\quad`)
        .at(-1)!
        .trim()
    : result.reason;
};

describe('derivative steps', () => {
  it('names the rules from the outside in and ends with the derivative', () => {
    const result = derivativeSteps('x^3 + 2x');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe('derivative');
    expect(result.steps.map((step) => step.rule)).toEqual(['sum', 'power', 'constantMultiple', 'variable', 'simplify']);
    expect(result.result).toBe(String.raw`3 \cdot x^{2}+2`);
    expect(result.steps[0].latex.startsWith(String.raw`\frac{d}{dx}\left[`)).toBe(true);
  });

  it('uses the product, quotient, and chain rules', () => {
    const rules = (latex: string) => {
      const result = derivativeSteps(latex);
      return result.ok ? result.steps.map((step) => step.rule) : [];
    };
    expect(rules(String.raw`x \sin(x)`)).toContain('product');
    expect(rules(String.raw`\frac{x}{x+1}`)).toContain('quotient');
    expect(rules(String.raw`\sin(x^2)`)).toEqual(['chain', 'power', 'simplify']);
    expect(rules(String.raw`\frac{d}{dt} t^2`)).toEqual(['power', 'simplify']);
  });

  it('works on the right side of y = and refuses what it cannot read', () => {
    const result = derivativeSteps('y = x^2');
    expect(result.ok && result.result).toBe('2x');
    expect(derivativeSteps(String.raw`\sqrt[3]{x}`)).toEqual({ ok: false, reason: 'unsupported' });
    expect(derivativeSteps('a + b')).toEqual({ ok: false, reason: 'letters' });
  });
});

describe('integral steps', () => {
  it('integrates sums, constant multiples, and powers', () => {
    const result = integralSteps(String.raw`\int 3x^2 + 2\,dx`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps[0].rule).toBe('sum');
    expect(result.steps.map((step) => step.rule)).toContain('power');
    expect(result.result).toMatch(/\+ C$/);
  });

  it('knows 1/x, the usual functions, and linear insides', () => {
    const result = (latex: string) => {
      const found = integralSteps(latex);
      return found.ok ? found.result : found.reason;
    };
    expect(result(String.raw`\int \frac{1}{x}\,dx`)).toContain(String.raw`\ln`);
    expect(result(String.raw`\int \cos(x)\,dx`)).toBe(String.raw`\sin\left(x\right) + C`);
    expect(result(String.raw`\int \sin(2x)\,dx`)).toContain('cos');
    expect(result(String.raw`\int e^{x}\,dx`)).toContain('exp');
    expect(result(String.raw`\int \tan(x)^{x}\,dx`)).toBe('notInTable');
  });

  it("works out a definite integral from the antiderivative, or by Simpson's rule", () => {
    const exact = integralSteps(String.raw`\int_0^3 x^2\,dx`);
    expect(exact.ok && exact.result).toBe('9');
    expect(exact.ok && exact.steps.at(-1)!.rule).toBe('evaluate');
    const numeric = integralSteps(String.raw`\int_0^1 \sin(x^2)\,dx`);
    expect(numeric.ok && numeric.steps[0].rule).toBe('numeric');
    expect(numeric.ok && Number(numeric.result)).toBeCloseTo(0.3102683017, 8);
    expect(stepsLatex(String.raw`\int_0^{\pi} \sin(x)\,dx`)).toMatchObject({ ok: true, result: '2' });
  });
});

describe('solve for systems and matrices', () => {
  it('solves a system of linear equations', () => {
    expect(answer(String.raw`x + y = 3 \\ x - y = 1`)).toBe(String.raw`x = 2,\ y = 1`);
    expect(answer(String.raw`\begin{cases} 2a + b = 5 \\ a - b = 1 \end{cases}`)).toBe(String.raw`a = 2,\ b = 1`);
    expect(answer('x + y + z = 6; y = 2; z = 3')).toBe(String.raw`x = 1,\ y = 2,\ z = 3`);
  });

  it('says when a system has no single answer, is not linear, or has the wrong count', () => {
    expect(answer(String.raw`x + y = 1 \\ 2x + 2y = 2`)).toBe('none');
    expect(answer(String.raw`x^2 + y = 1 \\ x - y = 0`)).toBe('unsupported');
    expect(answer(String.raw`x + y = 1 \\ x + y + z = 2`)).toBe('letters');
  });

  it('finds the determinant and inverse of a matrix, and what its power asks for', () => {
    const matrix = String.raw`\begin{pmatrix}4 & 7 \\ 2 & 6\end{pmatrix}`;
    expect(answer(matrix)).toBe(
      String.raw`\det = 10,\ \text{inverse} = \begin{pmatrix}\frac{3}{5} & -\frac{7}{10} \\ -\frac{1}{5} & \frac{2}{5}\end{pmatrix}`,
    );
    const det = solveLatex(String.raw`\det\begin{bmatrix}1 & 2 \\ 3 & 4\end{bmatrix}`);
    expect(det.ok && det.latex.endsWith('= -2')).toBe(true);
    const transpose = solveLatex(String.raw`\begin{pmatrix}1 & 2\end{pmatrix}^T`);
    expect(transpose.ok && transpose.latex.endsWith(String.raw`\begin{pmatrix}1 \\ 2\end{pmatrix}`)).toBe(true);
    expect(answer(String.raw`\begin{pmatrix}1 & 2 \\ 2 & 4\end{pmatrix}^{-1}`)).toBe('none');
  });
});
