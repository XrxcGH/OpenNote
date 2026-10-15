import { describe, expect, it } from 'vitest';
import { bar, glyph, integral, line, paren, plus, radical, square } from './fixtures';
import { shapeOf } from './geometry';
import { groupStrokes } from './group';
import type { MathStroke } from './group';
import { recognizeMath, toLatexChars } from './recognize';

/** Reads a symbol from the tag its first stroke carries, as the handwriting recognizer would read the scribble. */
const read = (strokes: MathStroke[]) =>
  Promise.resolve(strokes[0]?.key.startsWith('c:') ? strokes[0].key.slice(2) : null);
const latex = async (...parts: (MathStroke | MathStroke[])[]) => (await recognizeMath(parts.flat(), read)).latex;

describe('shapes made of lines', () => {
  it('tells bars, brackets, roots, and integrals apart', () => {
    expect(shapeOf(bar(0, 30, 20).points)).toBe('bar');
    expect(shapeOf(line('v', [5, 0], [5, 30]).points)).toBe('vbar');
    expect(shapeOf(paren('open', 10, 0, 40).points)).toBe('open');
    expect(shapeOf(paren('close', 10, 0, 40).points)).toBe('close');
    expect(shapeOf(square('open', 10, 0, 40).points)).toBe('openSquare');
    expect(shapeOf(square('close', 10, 0, 40).points)).toBe('closeSquare');
    expect(shapeOf(integral(0, 0, 40).points)).toBe('integral');
    expect(shapeOf(radical(0, 0, 30, 40).points)).toBe('radical');
    expect(shapeOf(glyph('x', 0, 0).points)).toBe('other');
  });
});

describe('grouping strokes into symbols', () => {
  it('joins the two strokes of a plus and the two bars of an equals sign', () => {
    const symbols = groupStrokes([...plus(0, 0), bar(20, 32, 4), bar(20, 32, 9)]);
    expect(symbols.map((s) => s.strokes.length)).toEqual([2, 2]);
    expect(symbols.find((s) => s.text === '=')).toBeTruthy();
  });

  it('keeps a fraction bar apart from the symbols above and below it', () => {
    const symbols = groupStrokes([glyph('1', 10, 0), bar(0, 30, 14), glyph('2', 10, 18)]);
    expect(symbols.map((s) => s.role).sort()).toEqual(['bar', 'char', 'char']);
  });
});

describe('handwritten math to LaTeX', () => {
  it('writes letters and digits in order', async () => {
    expect(await latex(glyph('a', 0, 0), plus(14, 0), glyph('b', 28, 0))).toBe('a+b');
  });

  it('keeps a minus between terms a minus', async () => {
    expect(await latex(glyph('a', 0, 0), bar(14, 24, 5), glyph('b', 28, 0))).toBe('a-b');
  });

  it('writes an equals sign', async () => {
    expect(await latex(glyph('x', 0, 0), bar(14, 26, 3), bar(14, 26, 8), glyph('2', 30, 0))).toBe('x=2');
  });

  it('puts a smaller raised symbol in an exponent and a lowered one in a subscript', async () => {
    expect(await latex(glyph('x', 0, 6, 10), glyph('2', 9, 0, 6))).toBe('x^{2}');
    expect(await latex(glyph('x', 0, 0, 10), glyph('1', 9, 7, 6))).toBe('x_{1}');
    expect(await latex(glyph('x', 0, 6, 10), glyph('1', 9, 0, 6), glyph('0', 16, 0, 6))).toBe('x^{10}');
  });

  it('reads a fraction', async () => {
    expect(await latex(glyph('1', 10, 0), bar(0, 30, 14), glyph('2', 10, 18))).toBe('\\frac{1}{2}');
  });

  it('reads a fraction with a longer line of symbols over it', async () => {
    const top = [glyph('a', 4, 0), plus(16, 0), glyph('b', 30, 0)].flat();
    expect(await latex(top, bar(0, 48, 14), glyph('c', 20, 18))).toBe('\\frac{a+b}{c}');
  });

  it('reads a fraction inside a fraction', async () => {
    const inner = [glyph('1', 25, 0), bar(15, 45, 14), glyph('2', 25, 18)];
    expect(await latex(inner, bar(0, 60, 36), glyph('3', 25, 40))).toBe('\\frac{\\frac{1}{2}}{3}');
  });

  it('reads a square root with what is under it', async () => {
    expect(await latex(radical(0, 0, 24, 30), glyph('x', 12, 6, 12), glyph('2', 23, 1, 7))).toBe('\\sqrt{x^{2}}');
  });

  it('reads a root with an index', async () => {
    expect(await latex(glyph('3', -6, 0, 6), radical(0, 0, 24, 30), glyph('x', 12, 6, 12))).toBe('\\sqrt[3]{x}');
  });

  it('reads an integral with its limits', async () => {
    expect(await latex(integral(0, 0, 40), glyph('1', 14, 0, 8), glyph('0', 12, 32, 8), glyph('x', 28, 14, 12))).toBe(
      '\\int_{0}^{1}x',
    );
  });

  it('reads a matrix in brackets, and in parentheses', async () => {
    const entries = [glyph('a', 10, 4), glyph('b', 30, 4), glyph('c', 10, 22), glyph('d', 30, 22)];
    expect(await latex(square('open', 0, 0, 36), entries, square('close', 46, 0, 36))).toBe(
      '\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}',
    );
    expect(await latex(paren('open', 2, 0, 36), entries, paren('close', 50, 0, 36))).toBe(
      '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}',
    );
  });

  it('keeps parentheses around one line of math as parentheses', async () => {
    expect(await latex(paren('open', 0, 0, 14), glyph('x', 8, 2, 10), paren('close', 22, 0, 14))).toBe('(x)');
  });

  it('counts the symbols it could not read and leaves them out', async () => {
    const result = await recognizeMath([glyph('a', 0, 0), { ...glyph('q', 14, 0), key: 'blot' }], read);
    expect(result).toEqual({ latex: 'a', unread: 1 });
  });

  it('gives nothing for no strokes', async () => {
    expect(await recognizeMath([], read)).toEqual({ latex: '', unread: 0 });
  });
});

describe('characters in LaTeX', () => {
  it('maps symbols to commands and drops what could change the markup', () => {
    expect(toLatexChars('×')).toBe('\\times');
    expect(toLatexChars('π')).toBe('\\pi');
    expect(toLatexChars('x\\input{a}')).toBe('xinput\\{a\\}');
    expect(toLatexChars('$#_^~&')).toBe('');
  });
});
