// Simplify and Solve on LaTeX (Phase 10): what they change, what they find, and the honest answers when they
// cannot read the equation, find nothing, or have nothing to do.
import { describe, expect, it } from 'vitest';
import { Unsupported, latexToText } from './convert';
import { simplifyLatex, solveLatex } from './actions';

describe('latexToText', () => {
  it('reads fractions, roots, products, and functions', () => {
    expect(latexToText(String.raw`\frac{1}{2}x`)).toBe('((1)/(2))x');
    expect(latexToText(String.raw`\sqrt{x+1} \cdot 2`)).toBe('sqrt(x+1) * 2');
    expect(latexToText(String.raw`\sin\left(\pi x\right)`)).toBe('sin(pi x)');
    expect(latexToText('x^{2}+1')).toBe('x^(2)+1');
  });

  it('refuses what it cannot read', () => {
    expect(() => latexToText(String.raw`\int_0^1 x`)).toThrow(Unsupported);
    expect(() => latexToText(String.raw`\sqrt[3]{x}`)).toThrow(Unsupported);
    expect(() => latexToText(String.raw`\frac{1`)).toThrow(Unsupported);
  });
});

describe('simplify', () => {
  it('gives a plain fraction for a sum of fractions', () => {
    expect(simplifyLatex(String.raw`\frac{1}{2}+\frac{1}{3}`)).toEqual({ ok: true, latex: String.raw`\frac{5}{6}` });
    expect(simplifyLatex(String.raw`\frac{6}{8}`)).toEqual({ ok: true, latex: String.raw`\frac{3}{4}` });
    expect(simplifyLatex('2+3*4')).toEqual({ ok: true, latex: '14' });
  });

  it('drops what does nothing in an expression with letters', () => {
    expect(simplifyLatex('x*1+0')).toEqual({ ok: true, latex: 'x' });
    expect(simplifyLatex(String.raw`2 \cdot 3x`)).toEqual({ ok: true, latex: '6x' });
  });

  it('simplifies both sides of an equation', () => {
    expect(simplifyLatex('x+0=2+2')).toEqual({ ok: true, latex: 'x = 4' });
  });

  it('says when there is nothing to do or it cannot read the LaTeX', () => {
    expect(simplifyLatex('x')).toEqual({ ok: false, reason: 'unchanged' });
    expect(simplifyLatex(String.raw`\int x`)).toEqual({ ok: false, reason: 'unsupported' });
    expect(simplifyLatex('2 +')).toEqual({ ok: false, reason: 'unsupported' });
  });
});

describe('solve', () => {
  const answer = (latex: string) => {
    const result = solveLatex(latex);
    return result.ok ? result.latex.split(String.raw`\quad\Rightarrow\quad`)[1].trim() : result.reason;
  };

  it('solves a linear equation', () => {
    expect(answer('2x+3=11')).toBe('x = 4');
  });

  it('finds every real root of a quadratic, smallest first', () => {
    expect(answer('x^2-4=0')).toBe(String.raw`x = -2,\ x = 2`);
  });

  it('finds a double root that only touches zero', () => {
    expect(answer('(x-1)^2=0')).toBe('x = 1');
  });

  it('gives a small fraction as a fraction', () => {
    expect(answer('2x=1')).toBe(String.raw`x = \frac{1}{2}`);
  });

  it('treats an expression with no equals sign as equal to zero', () => {
    expect(answer('x^2-9')).toBe(String.raw`x = -3,\ x = 3`);
  });

  it('uses whatever one letter the equation has', () => {
    expect(answer('3t-6=0')).toBe('t = 2');
  });

  it('keeps the equation and adds the answer after an arrow', () => {
    expect(solveLatex('2x+3=11')).toEqual({ ok: true, latex: String.raw`2x+3=11 \quad\Rightarrow\quad x = 4` });
  });

  it('does not count a gap in the curve as a root', () => {
    expect(answer(String.raw`\frac{1}{x}=0`)).toBe('none');
  });

  it('says so with no solution, with several letters, or with LaTeX it cannot read', () => {
    expect(answer('x^2+1=0')).toBe('none');
    expect(answer('x+y=1')).toBe('letters');
    expect(answer('4=4')).toBe('letters');
    expect(answer(String.raw`\int x=0`)).toBe('unsupported');
  });
});
