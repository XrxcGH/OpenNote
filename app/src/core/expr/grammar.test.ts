import { describe, expect, it } from 'vitest';
import { formatExpression } from './print';
import { GENERAL, evaluate, tryParse } from './general';
import { parse } from './parser';
import { parseStatement } from './statement';

/** The parsed tree written back with every grouping shown, which makes precedence easy to read. */
function shape(source: string): string {
  const node = parse(source, GENERAL);
  const show = (n: typeof node): string => {
    switch (n.type) {
      case 'binary':
        return `(${show(n.left)} ${n.op} ${show(n.right)})`;
      case 'unary':
        return `(${n.op}${show(n.arg)})`;
      case 'postfix':
        return `(${show(n.arg)}${n.op})`;
      case 'call':
        return `${n.name}[${n.args.map(show).join(' ')}]`;
      case 'num':
        return n.text;
      case 'name':
        return n.name;
      default:
        return n.type;
    }
  };
  return show(node);
}

function value(source: string): number {
  const result = evaluate(source);
  if (!result.ok) throw new Error(`${source}: ${result.error.code} at ${result.error.position}`);
  return result.value;
}

describe('precedence', () => {
  it.each([
    ['1+2*3', '(1 + (2 * 3))'],
    ['1-2-3', '((1 - 2) - 3)'],
    ['2^3^2', '(2 ^ (3 ^ 2))'],
    ['-2^2', '(-(2 ^ 2))'],
    ['2^-1', '(2 ^ (-1))'],
    ['-3!', '(-(3!))'],
    ['2^3!', '(2 ^ (3!))'],
    ['50%*2', '((50%) * 2)'],
    ['7 mod 3 * 2', '((7 mod 3) * 2)'],
    ['1/2x', '((1 / 2) * x)'],
    ['2x^2y', '((2 * (x ^ 2)) * y)'],
    ['--3', '(-(-3))'],
    ['(1+2)(3+4)', '((1 + 2) * (3 + 4))'],
    ['sin(30°)', 'sin[(30°)]'],
  ])('%s reads as %s', (source, expected) => {
    expect(shape(source)).toBe(expected);
  });
});

describe('numbers and symbols', () => {
  it('reads decimals, exponents, and the symbols people paste', () => {
    expect(value('.5 + 1.25')).toBe(1.75);
    expect(value('1.5e3')).toBe(1500);
    expect(value('2e+3*1')).toBe(2000);
    expect(value('6 × 7 ÷ 2 − 1')).toBe(20);
    expect(value('3²')).toBe(9);
    expect(value('2¹⁰')).toBe(1024);
    expect(value('2⁻¹')).toBe(0.5);
    expect(value('2 ** 5')).toBe(32);
    expect(value('π')).toBeCloseTo(Math.PI, 12);
    expect(value('√(16)')).toBe(4);
  });

  it('treats 2e as two times e and 2e3 as a number', () => {
    expect(value('2e')).toBeCloseTo(2 * Math.E, 12);
    expect(value('2e3')).toBe(2000);
  });
});

describe('mistakes', () => {
  function problem(source: string) {
    const result = tryParse(source);
    if (result.ok) throw new Error(`${source} should not parse`);
    return result.error;
  }

  it('says what went wrong and where', () => {
    expect(problem('')).toMatchObject({ code: 'empty' });
    expect(problem('2 +')).toMatchObject({ code: 'unexpected-end', position: 3, length: 0 });
    expect(problem('2 + * 3')).toMatchObject({ code: 'unexpected-token', position: 4, detail: '*' });
    expect(problem('(1 + 2')).toMatchObject({ code: 'unclosed-paren', position: 6, related: 0 });
    expect(problem('1 + 2)')).toMatchObject({ code: 'unexpected-token', position: 5 });
    expect(problem('2 3')).toMatchObject({ code: 'unexpected-token', position: 2 });
    expect(problem('2 $ 3')).toMatchObject({ code: 'bad-character', position: 2, detail: '$' });
    expect(problem('sin 30')).toMatchObject({ code: 'needs-parens', position: 0, detail: 'sin' });
    expect(problem('sqrt()')).toMatchObject({ code: 'arity', detail: 'sqrt' });
    expect(problem('1e999')).toMatchObject({ code: 'bad-number', position: 0 });
  });

  it('refuses text that is too long or nested too deeply, without throwing', () => {
    expect(problem('1+'.repeat(1500) + '1')).toMatchObject({ code: 'too-long' });
    expect(problem('('.repeat(500) + '1' + ')'.repeat(500))).toMatchObject({ code: 'too-deep' });
    expect(problem('-'.repeat(500) + '1')).toMatchObject({ code: 'too-deep' });
    expect(problem('2^'.repeat(500) + '1')).toMatchObject({ code: 'too-deep' });
    expect(value('('.repeat(40) + '1' + ')'.repeat(40))).toBe(1);
  });
});

describe('spans', () => {
  it('records where every node came from', () => {
    const node = parse('12 + sin(x)', GENERAL);
    expect(node).toMatchObject({ type: 'binary', start: 0, end: 11, pos: 3 });
    if (node.type !== 'binary') throw new Error('expected a sum');
    expect(node.right).toMatchObject({ type: 'call', start: 5, end: 11, pos: 5 });
  });

  it('includes brackets in the span of a group', () => {
    const node = parse('(1+2)*3', GENERAL);
    expect(node).toMatchObject({ type: 'binary', start: 0, end: 7, pos: 5 });
  });
});

describe('definitions', () => {
  it('reads a variable and a function definition', () => {
    expect(parseStatement('rent = 12', GENERAL)).toMatchObject({ kind: 'define', name: 'rent', params: [] });
    expect(parseStatement('f(x, y) = x*y', GENERAL)).toMatchObject({ kind: 'define', name: 'f', params: ['x', 'y'] });
    expect(parseStatement('2+2', GENERAL).kind).toBe('expr');
    expect(() => parseStatement('f(x) = ', GENERAL)).toThrow();
  });
});

describe('printing', () => {
  it.each([
    ['1+2*3', '1+2*3'],
    ['(1+2)*3', '(1+2)*3'],
    ['1-(2-3)', '1-(2-3)'],
    ['(1-2)-3', '1-2-3'],
    ['2^(3^2)', '2^3^2'],
    ['(2^3)^2', '(2^3)^2'],
    ['(-2)^2', '(-2)^2'],
    ['-(2^2)', '-2^2'],
    ['2x+1', '2x+1'],
    ['2(x+1)', '2(x+1)'],
    ['1/(2x)', '1/(2x)'],
    ['7 mod 3', '7 mod 3'],
    ['sin(x)^2', 'sin(x)^2'],
    ['(3+4)!', '(3+4)!'],
    ['3×4', '3*4'],
  ])('writes %s as %s', (source, expected) => {
    expect(formatExpression(parse(source, GENERAL))).toBe(expected);
  });
});
