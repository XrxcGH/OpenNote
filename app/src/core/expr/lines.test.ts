import { describe, expect, it } from 'vitest';
import { mathConstant } from './constants';
import { evaluateLines, type LineResult } from './lines';
import { NOTES_TEST, TEST_UNITS } from './testing';

function page(lines: string[]): LineResult[] {
  return evaluateLines(lines, { dialect: NOTES_TEST, units: TEST_UNITS, constants: mathConstant, angle: 'deg' });
}

/** A short word for each line: the kind, and the text of the answer where there is one. */
function summary(lines: string[]): string[] {
  return page(lines).map((r) => {
    switch (r.kind) {
      case 'result':
        return `result ${r.text}`;
      case 'define':
        return `define ${r.name} ${r.text}${r.shown ? ' shown' : ''}`;
      case 'function':
        return `function ${r.name}(${r.params.join(',')})`;
      case 'equation':
        return `equation ${r.bodyText}`;
      case 'error':
        return `error ${r.error.code}`;
      default:
        return r.kind;
    }
  });
}

describe('a worksheet', () => {
  it('defines a variable and uses it below', () => {
    expect(
      summary(['Monthly budget', 'rent = 1,200', 'food = 300', 'rent * 12 =', 'total = rent + food =', 'total / 2 =']),
    ).toEqual(['text', 'define rent 1200', 'define food 300', 'result 14400', 'define total 1500 shown', 'result 750']);
  });

  it('answers with units', () => {
    expect(summary(['5 mi in km =', 'speed = 100 km / 2 h', 'speed * 3 h =', 'speed in mph ='])).toEqual([
      'result 8.04672 km',
      'define speed 50 km/h',
      'result 150 km',
      'result 31.0685596119 mph',
    ]);
  });

  it('reads numbers with groups of digits', () => {
    expect(summary(['big = 1,234,567', 'big / 1,000 ='])).toEqual(['define big 1234567', 'result 1234.567']);
  });

  it('lets a name be defined again, and sees only what is above', () => {
    expect(summary(['x = 1', 'x =', 'x = x + 1', 'x ='])).toEqual(['define x 1', 'result 1', 'define x 2', 'result 2']);
    expect(summary(['a = b + 1', 'b = 2', 'a ='])).toEqual(['text', 'define b 2', 'error unknown-name']);
  });

  it('runs again with a changed line', () => {
    const before = summary(['n = 2', 'n * 10 =']);
    const after = summary(['n = 5', 'n * 10 =']);
    expect(before).toEqual(['define n 2', 'result 20']);
    expect(after).toEqual(['define n 5', 'result 50']);
  });

  it('says which names a line read', () => {
    const [, , result] = page(['a = 2', 'b = 3', 'a * b + 1 =']);
    expect(result.kind === 'result' && result.reads).toEqual(['a', 'b']);
  });
});

describe('functions of your own', () => {
  it('defines a function and calls it in later lines', () => {
    expect(summary(['f(x) = 2x + 1', 'f(3) =', 'f(f(1)) =', 'g(a; b) = a * b', 'g(2; 3) ='])).toEqual([
      'function f(x)',
      'result 7',
      'result 7',
      'function g(a,b)',
      'result 6',
    ]);
  });

  it('sees the variables defined above it', () => {
    expect(summary(['tax = 0.2', 'gross(net) = net * (1 + tax)', 'gross(100) ='])).toEqual([
      'define tax 0.2',
      'function gross(net)',
      'result 120',
    ]);
  });

  it('treats a variable followed by brackets as a product', () => {
    expect(summary(['rate = 12', 'rate(3) ='])).toEqual(['define rate 12', 'result 36']);
  });

  it('counts arguments and stops a function that calls itself', () => {
    expect(summary(['f(x) = x', 'f(1; 2) ='])).toEqual(['function f(x)', 'error arity']);
    expect(summary(['h(x) = h(x)', 'h(1) ='])).toEqual(['function h(x)', 'error too-deep']);
  });
});

describe('equations to graph', () => {
  it('offers y = an expression in x to the grapher', () => {
    const [line] = page(['y = x^2 + 1']);
    expect(line).toMatchObject({ kind: 'equation', bodyText: 'x^2+1' });
  });

  it('offers a function of x too, while still defining it', () => {
    const [line] = page(['f(x) = sin(x) / x']);
    expect(line).toMatchObject({ kind: 'function', name: 'f', params: ['x'], bodyText: 'sin(x)/x' });
  });

  it('defines y as a number once x has a value', () => {
    expect(summary(['x = 3', 'y = x^2'])).toEqual(['define x 3', 'define y 9']);
  });
});

describe('ordinary writing', () => {
  it('leaves lines that are not math alone', () => {
    const lines = ['Meeting at 3 pm', 'Total: 5', 'a = b', '2 + 2 = 4', '', '   ', 'See page 12 for details.'];
    expect(summary(lines)).toEqual(lines.map(() => 'text'));
  });

  it('does not show an answer for an expression without an equals sign', () => {
    expect(summary(['2 + 2', '5 km'])).toEqual(['text', 'text']);
  });
});

describe('mistakes', () => {
  it('reports an error when the line asked for an answer', () => {
    expect(summary(['1 / 0 =', 'unknown + 1 =', '(1 + =', '5 km + 3 s ='])).toEqual([
      'error divide-by-zero',
      'error unknown-name',
      'error unexpected-end',
      'error unit-mismatch',
    ]);
  });

  it('reports arithmetic errors in a definition, but not a name it does not know', () => {
    expect(summary(['rent = 1/0', 'rent = missing', 'width = 5 km + 3 s'])).toEqual([
      'error divide-by-zero',
      'text',
      'error unit-mismatch',
    ]);
  });

  it('gives the place of the problem within the line', () => {
    const [line] = page(['1 + 2 / 0 =']);
    expect(line).toMatchObject({ kind: 'error', error: { code: 'divide-by-zero', position: 6 } });
  });
});
