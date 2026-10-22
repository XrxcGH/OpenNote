// The equation panel's Steps (derivatives and integrals) and Solve for systems of equations and matrices.
import { describe, expect, it } from 'vitest';
import { solveLatex } from './actions';
import { stepsBlock, stepsLatex } from './steps';
import type { Step } from './steps';

const answer = (latex: string) => {
  const result = solveLatex(latex);
  return result.ok
    ? result.latex
        .split(String.raw`\quad\Rightarrow\quad`)
        .at(-1)!
        .trim()
    : result.reason;
};

const rules = (steps: readonly Step[]): string[] => steps.map((step) => step.rule);
const inner = (latex: string): string[] => {
  const result = stepsLatex(latex);
  return result.ok ? rules(result.steps[0].children ?? []) : [];
};

describe('derivative steps', () => {
  it('names each rule, with the parts it needs folded inside, and ends with the derivative', () => {
    const result = stepsLatex('x^3 + 2x');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe('derivative');
    expect(rules(result.steps)).toEqual(['sum']);
    expect(inner('x^3 + 2x')).toEqual(['power', 'constantMultiple']);
    expect(result.result).toBe('3x^{2} + 2');
    expect(result.steps[0].latex.startsWith(String.raw`\frac{d}{dx}\left[`)).toBe(true);
  });

  it('uses the product, quotient, and chain rules', () => {
    const top = (latex: string) => {
      const result = stepsLatex(latex);
      return result.ok ? result.steps[0].rule : '';
    };
    expect(top(String.raw`x \sin(x)`)).toBe('product');
    expect(top(String.raw`\frac{x}{x+1}`)).toBe('quotient');
    expect(top(String.raw`\sin(x^2)`)).toBe('chain');
    expect(inner(String.raw`\sin(x^2)`)).toEqual(['trig', 'power']);
    expect(top(String.raw`\frac{d}{dt} t^2`)).toBe('power');
  });

  it('works on the right side of y = and refuses what it cannot read', () => {
    const result = stepsLatex('y = x^2');
    expect(result.ok && result.result).toBe('2x');
    expect(stepsLatex(String.raw`\sqrt[3]{x}`)).toMatchObject({ ok: false, reason: 'unsupported' });
    expect(stepsLatex('a + b')).toMatchObject({ ok: false, reason: 'letters' });
  });

  it('puts the working on the page as aligned LaTeX with each rule named', () => {
    const result = stepsLatex(String.raw`\frac{d}{dx}\sin(x^2)`);
    if (!result.ok) throw new Error('no steps');
    const block = stepsBlock(result.steps, (step) => step.rule, result.result, 'Steps');
    expect(block.startsWith(String.raw`\begin{aligned}`)).toBe(true);
    expect(block).toContain(String.raw`\text{chain}`);
    expect(block).toContain(String.raw`\quad \frac{d}{du}`);
    expect(block.trim().endsWith(String.raw`\end{aligned}`)).toBe(true);
  });
});

describe('integral steps', () => {
  it('integrates sums, constant multiples, and powers', () => {
    const result = stepsLatex(String.raw`\int 3x^2 + 2\,dx`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps[0].rule).toBe('sum');
    expect(result.steps.at(-1)!.rule).toBe('constantOfIntegration');
    expect(result.result).toBe('x^{3} + 2x + C');
  });

  it('knows 1/x, the usual functions, and linear insides', () => {
    const result = (latex: string) => {
      const found = stepsLatex(latex);
      return found.ok ? found.result : found.reason;
    };
    expect(result(String.raw`\int \frac{1}{x}\,dx`)).toBe(String.raw`\ln\left|x\right| + C`);
    expect(result(String.raw`\int \cos(x)\,dx`)).toBe(String.raw`\sin x + C`);
    expect(result(String.raw`\int \sin(2x)\,dx`)).toBe(String.raw`-\frac{\cos\left(2x\right)}{2} + C`);
    expect(result(String.raw`\int e^{x}\,dx`)).toBe('e^{x} + C');
    expect(result(String.raw`\int \tan(x)^{x}\,dx`)).toBe('notInTable');
  });

  it('works out a definite integral exactly, or numerically when there is no antiderivative', () => {
    const exact = stepsLatex(String.raw`\int_0^3 x^2\,dx`);
    expect(exact.ok && exact.result).toBe('9');
    expect(exact.ok && exact.steps.at(-1)!.rule).toBe('evaluate');
    const numeric = stepsLatex(String.raw`\int_0^1 \sin(x^2)\,dx`);
    expect(numeric.ok && numeric.steps[0].rule).toBe('numeric');
    expect(numeric.ok && numeric.result).toBe(String.raw`\approx 0.310268`);
    expect(stepsLatex(String.raw`\int_0^{\pi} \sin(x)\,dx`)).toMatchObject({ ok: true, result: '2' });
  });

  it('names substitution, parts, partial fractions, and trig identities', () => {
    const all = (steps: readonly Step[]): string[] => steps.flatMap((step) => [step.rule, ...all(step.children ?? [])]);
    const top = (latex: string) => {
      const result = stepsLatex(latex);
      return result.ok ? result.steps[0].rule : result.reason;
    };
    const found = stepsLatex(String.raw`\int 2x\cos(x^{2})\,dx`);
    expect(found.ok && all(found.steps)).toContain('substitution');
    expect(top(String.raw`\int x e^{x}\,dx`)).toBe('parts');
    expect(top(String.raw`\int \frac{1}{x^{2}-1}\,dx`)).toBe('partialFractions');
    expect(top(String.raw`\int \sin^{2} x\,dx`)).toBe('powerReduction');
    expect(top(String.raw`\int e^{x}\sin x\,dx`)).toBe('partsCyclic');
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
