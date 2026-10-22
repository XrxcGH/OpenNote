// Live solving on page lines: an equation with one unknown is solved on the line being typed, with the page's
// variables, constants, and units.
import { describe, expect, it } from 'vitest';
import { findRoots, tidyRoot } from '../../../core/expr';
import { evaluateNotes } from './notes';

/** The result of the last line, solved. */
const solve = (...lines: string[]) => evaluateNotes(lines, { solveLine: lines.length - 1 }).at(-1)!;
const text = (...lines: string[]) => {
  const result = solve(...lines);
  return result.kind === 'solve' ? result.text : result.kind;
};

describe('live solving', () => {
  it('solves a linear equation for its one letter', () => {
    expect(text('2x+3=11')).toBe('x = 4');
    expect(text('10 = 2y')).toBe('y = 5');
    expect(text('3(t - 1) = 2t + 4')).toBe('t = 7');
    expect(text('x/4 = 0.5')).toBe('x = 2');
  });

  it('finds every root of a quadratic, smallest first', () => {
    expect(text('x^2 = 9')).toBe('x = -3 or x = 3');
    expect(text('x^2 - 2x + 1 = 0')).toBe('x = 1');
    expect(text('x^2 = -1')).toBe('text');
  });

  it('uses the page variables and constants above the line', () => {
    expect(text('rate = 3', 'rate * h = 12')).toBe('h = 4');
    expect(text('a = 5', 'a = 2b + 1')).toBe('b = 2');
    expect(text('2 pi r = 10')).toMatch(/^r = 1\.59154943/);
  });

  it('carries units through', () => {
    expect(text('d = 100 m', 't = 10 s', 'd = v t')).toBe('v = 10 m/s');
    expect(text('x + 5 m = 12 m')).toBe('x = 7 m');
    expect(text('2 s * v = 10 m')).toBe('v = 5 m/s');
    expect(text('w = 4 kg', 'w * a = 12 kg')).toBe('a = 3');
  });

  it('leaves alone a line with no unknown, two unknowns, or a question', () => {
    expect(text('x = 4', '2x + 3 = 11')).toBe('text');
    expect(text('a + b = 3')).toBe('text');
    expect(text('2 + 3 =')).toBe('result');
    expect(text('Meeting = 3 pm')).toBe('text');
    expect(text('rent = 1200')).toBe('define');
    expect(text('y = x^2')).toBe('equation');
  });

  it('solves only the line it is asked to', () => {
    const results = evaluateNotes(['2x = 4', '3y = 9'], { solveLine: 1 });
    expect(results[0].kind).toBe('text');
    expect(results[1].kind).toBe('solve');
    expect(evaluateNotes(['2x = 4'])[0].kind).toBe('text');
  });
});

describe('the root finder', () => {
  it('finds crossings and touches, skips gaps, and never throws', () => {
    expect(findRoots((x) => x * x - 4)).toEqual([-2, 2].map((v) => expect.closeTo(v, 9)));
    expect(findRoots((x) => (x - 1) ** 2).map(tidyRoot)).toEqual([1]);
    expect(findRoots((x) => 1 / x)).toEqual([]);
    expect(
      findRoots(() => {
        throw new Error('no');
      }),
    ).toEqual([]);
    expect(findRoots((x) => Math.sin(x), { range: 4, limit: 2 }).length).toBe(2);
    expect(tidyRoot(3.99999999999)).toBe(4);
  });
});
