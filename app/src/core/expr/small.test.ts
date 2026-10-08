import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { freeNames, walk, type Node } from './ast';
import { mathConstant } from './constants';
import { attempt, ExprError, pointAt } from './errors';
import { GENERAL, tryParse } from './general';
import { formatNumber } from './numfmt';
import { parse } from './parser';
import { columnFromLetters, lettersFromColumn, readCell, readColumn } from './refs';
import { splitWords } from './words';
import { tokenize } from './lexer';
import { LETTERS } from './testing';

describe('column letters', () => {
  it('counts like a spreadsheet', () => {
    expect(lettersFromColumn(0)).toBe('A');
    expect(lettersFromColumn(25)).toBe('Z');
    expect(lettersFromColumn(26)).toBe('AA');
    expect(lettersFromColumn(701)).toBe('ZZ');
    expect(lettersFromColumn(702)).toBe('AAA');
    expect(columnFromLetters('aa')).toBe(26);
    expect(columnFromLetters('')).toBe(-1);
    expect(columnFromLetters('ABCD')).toBe(-1);
    expect(columnFromLetters('A1')).toBe(-1);
  });

  it('goes back and forth', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 18277 }), (column) => {
        expect(columnFromLetters(lettersFromColumn(column))).toBe(column);
      }),
    );
  });

  it('reads cells and columns with fixed marks', () => {
    expect(readCell('$C$12')).toEqual({ col: 2, row: 11 });
    expect(readCell('A0')).toEqual({ col: 0, row: -1 });
    expect(readCell('12')).toBeNull();
    expect(readColumn('$B')).toBe(1);
    expect(readColumn('B2')).toBe(-1);
  });
});

describe('formatting numbers', () => {
  it('reads back to nearly the same number at full precision', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e300, max: 1e300 }), (value) => {
        for (const notation of ['auto', 'scientific', 'engineering'] as const) {
          const text = formatNumber(value, { digits: 15, notation });
          const back = Number(text);
          expect(Math.abs(back - value)).toBeLessThanOrEqual(Math.abs(value) * 1e-14);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('writes fixed notation with the decimals asked for', () => {
    expect(formatNumber(1234.5678, { notation: 'fixed', decimals: 1 })).toBe('1234.6');
    expect(formatNumber(NaN)).toBe('NaN');
    expect(formatNumber(-Infinity)).toBe('-Infinity');
  });
});

describe('errors', () => {
  it('turns a thrown ExprError into a result, and lets other errors through', () => {
    expect(attempt(() => 5)).toEqual({ ok: true, value: 5 });
    expect(attempt(() => parse('(1', GENERAL))).toMatchObject({ ok: false, error: { code: 'unclosed-paren' } });
    expect(() =>
      attempt(() => {
        throw new TypeError('a bug');
      }),
    ).toThrow(TypeError);
  });

  it('adds a place once, to the innermost failure', () => {
    const inner = new ExprError('domain').at(4, 'sqrt', 3);
    expect(inner).toMatchObject({ position: 4, detail: 'sqrt', length: 3 });
    expect(inner.at(0, 'outer')).toBe(inner);
  });

  it('draws carets under the problem', () => {
    const result = tryParse('1 + $ + 2');
    if (result.ok) throw new Error('should fail');
    expect(pointAt('1 + $ + 2', result.error)).toBe('1 + $ + 2\n    ^ bad-character');
  });
});

describe('walking a tree', () => {
  it('visits outer nodes first and can stop going deeper', () => {
    const tree = parse('sin(a + 2) * b', GENERAL);
    const seen: string[] = [];
    walk(tree, (node: Node) => {
      seen.push(node.type);
    });
    expect(seen).toEqual(['binary', 'call', 'binary', 'name', 'num', 'name']);
    const shallow: string[] = [];
    walk(tree, (node) => {
      shallow.push(node.type);
      return node.type !== 'call';
    });
    expect(shallow).toEqual(['binary', 'call', 'name']);
  });

  it('lists the names a tree reads, once each, in order', () => {
    expect(freeNames(parse('b + a*b + sin(c) + pi', GENERAL))).toEqual(['b', 'a', 'c', 'pi']);
  });
});

describe('splitting letters', () => {
  const split = (text: string): string[] => {
    const lone: string[] = [];
    const tokens = splitWords(tokenize(text, LETTERS.lex), LETTERS.split ?? new Set(), (letter) => {
      lone.push(letter);
    });
    return [
      ...tokens.filter((t) => t.kind !== 'eof').map((t) => `${t.kind}:${t.text}@${t.start}`),
      ...lone.map((l) => `?${l}`),
    ];
  };

  it('takes the longest known name each time and keeps digits whole', () => {
    expect(split('pix')).toEqual(['name:pi@0', 'name:x@2']);
    expect(split('atan2')).toEqual(['name:atan2@0']);
    expect(split('cos2x')).toEqual(['name:cos@0', 'num:2@3', 'name:x@4']);
    expect(split('log10')).toEqual(['name:log10@0']);
    expect(split('x3')).toEqual(['name:x@0', 'num:3@1']);
  });

  it('reports each unknown letter and carries on', () => {
    expect(split('qx')).toEqual(['name:q@0', 'name:x@1', '?q']);
  });

  it('tries no more prefixes than the longest name has letters, so a long run splits in linear time', () => {
    class CountingSet extends Set<string> {
      lookups = 0;
      override has(value: string): boolean {
        this.lookups += 1;
        return super.has(value);
      }
    }
    const known = new CountingSet(['x', 'pi', 'sin', 'atan2']);
    const run = 'xq'.repeat(300);
    const tokens = splitWords(tokenize(run, LETTERS.lex), known, () => {});
    expect(tokens.filter((t) => t.kind === 'name')).toHaveLength(run.length);
    expect(known.lookups).toBeLessThan(run.length * 8);
  });
});

describe('constants', () => {
  it('does not find names that only exist on every object', () => {
    expect(mathConstant('pi')).toBe(Math.PI);
    expect(mathConstant('constructor')).toBeUndefined();
    expect(mathConstant('__proto__')).toBeUndefined();
  });
});

describe('running out of stack', () => {
  it('turns a stack overflow into a too-deep problem and lets other errors through', () => {
    const recurse = (n: number): number => recurse(n + 1) + 1;
    expect(attempt(() => recurse(0))).toMatchObject({ ok: false, error: { code: 'too-deep' } });
    expect(() =>
      attempt(() => {
        throw new RangeError('toFixed() digits argument must be between 0 and 100');
      }),
    ).toThrow(RangeError);
  });
});
