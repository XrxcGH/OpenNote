import { describe, expect, it } from 'vitest';
import { syntheticStyle } from './fixtures';
import { MAX_LATEX, parseLatex } from './latex';
import type { MathNode } from './latex';
import { mathFigure } from './mathLayout';
import { writeRuns } from './write';
import type { InkPath } from './write';

const style = syntheticStyle();
const box = (paths: InkPath[]) => {
  const all = paths.flat();
  return {
    x0: Math.min(...all.map((p) => p.x)),
    x1: Math.max(...all.map((p) => p.x)),
    y0: Math.min(...all.map((p) => p.y)),
    y1: Math.max(...all.map((p) => p.y)),
  };
};

describe('reading LaTeX', () => {
  it('reads the structure: fractions, scripts, roots, operators, brackets, matrices, aligned lines', () => {
    const t = (node: MathNode) => node.t;
    expect(t(parseLatex('\\frac{a}{b}'))).toBe('frac');
    const scripts = parseLatex('x_i^2') as Extract<MathNode, { t: 'scripts' }>;
    expect(scripts.t).toBe('scripts');
    expect(scripts.sup && scripts.sub).toBeTruthy();
    expect(t(parseLatex('\\sqrt[3]{x}'))).toBe('sqrt');
    expect(t(parseLatex('\\left( x \\right)'))).toBe('delim');
    const integral = parseLatex('\\int_0^1 f') as Extract<MathNode, { t: 'row' }>;
    expect(integral.items[0].t).toBe('scripts');
    const matrix = parseLatex('\\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}') as Extract<MathNode, { t: 'matrix' }>;
    expect(matrix.rows).toHaveLength(2);
    expect(matrix.rows[0]).toHaveLength(2);
    expect(matrix.open).toBe('[');
    const aligned = parseLatex('a &= b \\\\ &= c') as Extract<MathNode, { t: 'align' }>;
    expect(aligned.t).toBe('align');
    expect(aligned.rows).toHaveLength(2);
  });

  it('never throws on broken or hostile input', () => {
    for (const source of [
      '\\frac{',
      '}}}{{',
      '\\left(',
      '\\begin{matrix',
      '^^__',
      '\\',
      '{'.repeat(5000),
      '\\sqrt['.repeat(200),
    ]) {
      expect(() => parseLatex(source)).not.toThrow();
      expect(() => mathFigure(source, style, 1)).not.toThrow();
    }
    expect(() => parseLatex('x'.repeat(MAX_LATEX * 3))).not.toThrow();
  });

  it('writes unknown commands as their names, so nothing typed is lost', () => {
    expect(parseLatex('\\foo')).toEqual({ t: 'text', s: 'foo' });
  });
});

describe('handwritten math layout', () => {
  it('puts the numerator over the bar and the denominator under it', () => {
    const fig = mathFigure('\\frac{a}{b}', style, 1);
    const bar = fig.paths.find((p) => p.length === 9 && Math.abs(p[0].y - p[8].y) < 0.01)!;
    expect(bar).toBeTruthy();
    const barY = bar[0].y;
    const others = fig.paths.filter((p) => p !== bar);
    const above = others.filter((p) => box([p]).y1 < barY);
    const below = others.filter((p) => box([p]).y0 > barY);
    expect(above.length).toBeGreaterThan(0);
    expect(below.length).toBeGreaterThan(0);
    expect(above.length + below.length).toBe(others.length);
    // The bar reaches past both.
    expect(Math.min(bar[0].x, bar[8].x)).toBeLessThan(box(others).x0);
    expect(Math.max(bar[0].x, bar[8].x)).toBeGreaterThan(box(others).x1);
  });

  it('raises a superscript and makes it smaller', () => {
    const base = mathFigure('x', style, 1);
    const fig = mathFigure('x^2', style, 1);
    const two = fig.paths.filter((p) => box([p]).x0 > box(base.paths).x1);
    expect(two.length).toBeGreaterThan(0);
    expect(box(two).y1).toBeLessThan(-0.3);
    expect(box(two).y1 - box(two).y0).toBeLessThan(1.45 * 0.8);
  });

  it('lowers a subscript', () => {
    const fig = mathFigure('x_1', style, 1);
    const base = mathFigure('x', style, 1);
    const one = fig.paths.filter((p) => box([p]).x0 > box(base.paths).x1);
    expect(box(one).y1).toBeGreaterThan(0.2);
  });

  it('draws a root sign whose bar covers the whole radicand', () => {
    const fig = mathFigure('\\sqrt{abc}', style, 1);
    const abc = mathFigure('abc', style, 1);
    const top = fig.paths.find((p) => p.length === 9 && Math.abs(p[0].y - p[8].y) < 0.01)!;
    expect(top[8].x - top[0].x).toBeGreaterThan(box(abc.paths).x1 - box(abc.paths).x0);
    expect(top[0].y).toBeLessThan(box(abc.paths).y0);
  });

  it('puts an integral’s limits at its top and bottom, and a sum’s over and under it', () => {
    const integral = mathFigure('\\int_0^1', style, 1);
    expect(integral.ascent).toBeGreaterThan(1.6);
    expect(integral.descent).toBeGreaterThan(0.4);
    const sum = mathFigure('\\sum_{i=1}^{n}', style, 1);
    const plainSum = mathFigure('\\sum', style, 1);
    expect(sum.ascent).toBeGreaterThan(plainSum.ascent);
    expect(sum.descent).toBeGreaterThan(plainSum.descent);
    // The limits sit within the sum's width, not after it.
    expect(sum.width).toBeLessThan(plainSum.width * 2.2);
  });
});

describe('handwritten math layout of brackets, matrices, and lines', () => {
  it('makes brackets as tall as what they hold', () => {
    const small = mathFigure('\\left( x \\right)', style, 1);
    const tall = mathFigure('\\left( \\frac{a}{b} \\right)', style, 1);
    expect(tall.ascent + tall.descent).toBeGreaterThan((small.ascent + small.descent) * 1.3);
  });

  it('lays a matrix out in rows and columns', () => {
    const fig = mathFigure('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', style, 1);
    const row = mathFigure('\\begin{pmatrix} a & b \\end{pmatrix}', style, 1);
    expect(fig.ascent + fig.descent).toBeGreaterThan((row.ascent + row.descent) * 1.5);
  });

  it('lines aligned equations up at their & marks', () => {
    const fig = mathFigure('x &= 1 \\\\ yyyy &= 22', style, 1);
    // Both lines' equals signs start at the same x: find the two-bar groups.
    const bars = fig.paths.filter((p) => {
      const b = box([p]);
      return b.y1 - b.y0 < 0.15 && b.x1 - b.x0 > 0.4;
    });
    expect(bars.length).toBeGreaterThanOrEqual(4);
    const lefts = bars.map((p) => box([p]).x0).sort((a, b) => a - b);
    expect(lefts[lefts.length - 1] - lefts[0]).toBeLessThan(0.4);
    expect(fig.descent).toBeGreaterThan(1.5);
  });

  it('lists the symbols that came from the neutral hand', () => {
    expect(mathFigure('\\alpha + \\nabla', style, 1).missing).toEqual(['α', '∇']);
  });

  it('flows into the writer as part of a line, and takes extra lines when tall', () => {
    const place = { left: 0, width: 500, baseline: 40, xHeight: 10, next: (y: number) => y + 30 };
    const inline = writeRuns(
      [
        { kind: 'text', text: 'so ' },
        { kind: 'figure', figure: mathFigure('x^2', style, 1), display: false },
      ],
      style,
      place,
      1,
    );
    expect(inline.lines).toBe(1);
    const display = writeRuns(
      [
        { kind: 'text', text: 'so' },
        {
          kind: 'figure',
          figure: mathFigure('\\begin{aligned} a&=b\\\\c&=d\\\\e&=f \\end{aligned}', style, 1),
          display: true,
        },
      ],
      style,
      place,
      1,
    );
    expect(display.lines).toBeGreaterThan(3);
  });
});
