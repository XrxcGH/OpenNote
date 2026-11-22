// The comparators (DESIGN 9.1). Every expected value is a hand-worked answer or comes from the rule a judge
// documents: Kattis accepts a number whose absolute or relative error is within the tolerance.
import { describe, expect, it } from 'vitest';
import type { CompareSpec } from '../contracts';
import { compareJson, compareText, firstDifferentLine, showJson } from './compare';
import { diffLines, firstDifferentToken } from './diff';
import { compareResultSets, parseCsv } from './resultSets';

const pass = (actual: string, expected: string, spec: CompareSpec) => compareText(actual, expected, spec).pass;
const NUMBER: CompareSpec = { mode: 'number' };

describe('number mode', () => {
  // 1/3 is 0.3333... exactly; the tolerance is 1e-6 by default.
  it('accepts 0.3333333 for 1/3 and rejects 0.3333', () => {
    expect(pass('0.3333333', '0.333333333333', NUMBER)).toBe(true);
    expect(pass('0.3333', '0.333333333333', NUMBER)).toBe(false);
  });

  it('takes the absolute or the relative error, whichever is within the tolerance', () => {
    // 0.5 away from 1000000 is a relative error of 5e-7, within 1e-6, but not an absolute one.
    expect(pass('1000000.5', '1000000', NUMBER)).toBe(true);
    expect(pass('1000000.5', '1000000', { mode: 'number', relative: false })).toBe(false);
    // 0.0000005 away from 0 is an absolute error of 5e-7, and no relative error is ever within a bound of 0.
    expect(pass('0.0000005', '0', NUMBER)).toBe(true);
    expect(pass('0.0000005', '0', { mode: 'number', relative: true })).toBe(false);
  });

  it('uses the case tolerance', () => {
    expect(pass('3.14', '3.14159', { mode: 'number', tolerance: 0.01 })).toBe(true);
    expect(pass('3.14', '3.14159', { mode: 'number', tolerance: 0.0001 })).toBe(false);
  });

  it('compares words that are not numbers as they are, and needs the same count', () => {
    expect(pass('yes 1.0000001', 'yes 1', NUMBER)).toBe(true);
    expect(pass('no 1', 'yes 1', NUMBER)).toBe(false);
    expect(pass('1 2', '1 2 3', NUMBER)).toBe(false);
    expect(compareText('1 2 4', '1 2 3', NUMBER)).toMatchObject({ pass: false, token: 3 });
  });

  it('does not read 0x10 or Infinity as a number', () => {
    expect(pass('16', '0x10', NUMBER)).toBe(false);
    expect(pass('Infinity', 'Infinity', NUMBER)).toBe(true);
  });
});

describe('the other modes', () => {
  it('tokens: spacing does not matter', () => {
    expect(pass('1  2\n', '1 2', { mode: 'tokens' })).toBe(true);
    expect(pass('1 2', '1 3', { mode: 'tokens' })).toBe(false);
    expect(pass('1 2 3', '1 2', { mode: 'tokens' })).toBe(false);
  });

  it('exact: the same characters', () => {
    expect(pass('1  2\n', '1 2', { mode: 'exact' })).toBe(false);
    expect(pass('1 2\n', '1 2\n', { mode: 'exact' })).toBe(true);
    expect(compareText('a\nb\nc', 'a\nB\nc', { mode: 'exact' })).toMatchObject({ pass: false, line: 2 });
  });

  it('trim: trailing spaces and the final line break are ignored, leading spaces are not', () => {
    expect(pass('a  \r\nb\n\n', 'a\nb', { mode: 'trim' })).toBe(true);
    expect(pass(' a\nb', 'a\nb', { mode: 'trim' })).toBe(false);
  });

  it('lines-unordered: the same lines in any order', () => {
    expect(pass('b\na\nc\n', 'a\nb\nc', { mode: 'lines-unordered' })).toBe(true);
    expect(pass('a\na\nb', 'a\nb\nb', { mode: 'lines-unordered' })).toBe(false);
  });

  it('regex: the expected text is the pattern; a bad pattern fails and says so', () => {
    expect(pass('result: 42\n', '^result: \\d+$', { mode: 'regex' })).toBe(true);
    expect(pass('result: x', '^result: \\d+$', { mode: 'regex' })).toBe(false);
    expect(compareText('x', '(', { mode: 'regex' })).toMatchObject({ pass: false, reason: 'badPattern' });
  });

  it('finds the first differing line', () => {
    expect(firstDifferentLine('a\nb\nc', 'a\nb\nd')).toBe(3);
    expect(firstDifferentLine('a\nb', 'a\nb')).toBeNull();
  });
});

describe('JSON values', () => {
  it('ignores spacing and key order', () => {
    expect(compareJson('[0,1]', '[0, 1]', { mode: 'exact' }).pass).toBe(true);
    expect(compareJson('{"b":1,"a":[2]}', '{ "a": [2], "b": 1 }', { mode: 'exact' }).pass).toBe(true);
    expect(compareJson('[0,1]', '[1, 0]', { mode: 'exact' }).pass).toBe(false);
  });

  it('keeps null and false apart, and a number apart from its text', () => {
    expect(compareJson('null', 'null', { mode: 'exact' }).pass).toBe(true);
    expect(compareJson('null', 'false', { mode: 'exact' }).pass).toBe(false);
    expect(compareJson('"1"', '1', { mode: 'exact' }).pass).toBe(false);
  });

  it('gives numbers a tolerance only in number mode', () => {
    // 0.1 + 0.2 is the double nearest 0.30000000000000004.
    expect(compareJson('0.30000000000000004', '0.3', { mode: 'exact' }).pass).toBe(false);
    expect(compareJson('0.30000000000000004', '0.3', NUMBER).pass).toBe(true);
    expect(compareJson('[0.30000000000000004,[1]]', '[0.3,[1]]', NUMBER).pass).toBe(true);
  });

  it('fails a value that is not JSON, and compares text when the expectation is not JSON', () => {
    expect(compareJson('oops', '[1]', { mode: 'exact' })).toMatchObject({ pass: false, reason: 'notJson' });
    expect(compareJson('hello', 'hello', { mode: 'exact' }).pass).toBe(true);
  });

  it('shows a value on one line with spaces after commas and colons', () => {
    expect(showJson('{"a":[1,2],"b":null}')).toBe('{"a": [1, 2], "b": null}');
    expect(showJson('not json')).toBe('not json');
  });
});

describe('SQL result sets', () => {
  it('reads CSV with quotes, doubled quotes, and line breaks inside quotes', () => {
    expect(parseCsv('id,name\n1,"Smith, A"\n2,"say ""hi"""\n3,"two\nlines"\n')).toEqual([
      ['id', 'name'],
      ['1', 'Smith, A'],
      ['2', 'say "hi"'],
      ['3', 'two\nlines'],
    ]);
    expect(parseCsv('a,b\r\n1,2\r\n\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('compares rows in order or as a set', () => {
    const rows = 'n,sq\n1,1\n2,4\n3,9';
    const shuffled = 'n,sq\n3,9\n1,1\n2,4';
    expect(compareResultSets(shuffled, rows, false, { mode: 'exact' }).pass).toBe(true);
    expect(compareResultSets(shuffled, rows, true, { mode: 'exact' })).toMatchObject({ pass: false, line: 2 });
  });

  it('needs the same column names and row count', () => {
    expect(compareResultSets('n,sq\n1,1', 'n,square\n1,1', false, { mode: 'exact' })).toMatchObject({ line: 1 });
    expect(compareResultSets('n\n1\n2', 'n\n1', false, { mode: 'exact' }).pass).toBe(false);
  });

  it('gives numeric cells a tolerance in number mode', () => {
    expect(compareResultSets('avg\n2.3333333', 'avg\n2.3333333333', true, NUMBER).pass).toBe(true);
    expect(compareResultSets('avg\n2.33', 'avg\n2.3333333333', true, NUMBER).pass).toBe(false);
  });
});

describe('the diff', () => {
  it('marks lines of each side and keeps the common ones', () => {
    expect(diffLines('a\nb\nc', 'a\nx\nc')).toEqual([
      { side: 'same', text: 'a', line: 1 },
      { side: 'actual', text: 'x', line: 2 },
      { side: 'expected', text: 'b', line: 2 },
      { side: 'same', text: 'c', line: 3 },
    ]);
  });

  it('names the first differing item', () => {
    expect(firstDifferentToken('1 2 3', '1 2 4')).toEqual({ at: 3, expected: '3', actual: '4' });
    expect(firstDifferentToken('1 2', '1 2')).toBeNull();
  });
});

describe('regex safety', () => {
  const REGEX: CompareSpec = { mode: 'regex' };
  it('refuses nested quantifiers at once instead of running for hours', () => {
    const started = Date.now();
    // (a+)+ against "aaaa...!" takes exponential time in a backtracking matcher: a documented ReDoS case.
    const got = compareText(`${'a'.repeat(40)}!`, '^(a+)+$', REGEX);
    expect(got).toEqual({ pass: false, reason: 'tooComplex' });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('refuses a quantified group whose alternatives can start the same way', () => {
    expect(compareText('aaaa!', '^(a|a)*$', REGEX).reason).toBe('tooComplex');
    expect(compareText('aaaa!', '^(a|ab)+$', REGEX).reason).toBe('tooComplex');
  });

  it('refuses a pattern over 500 characters and a text over 20000', () => {
    expect(compareText('x', 'a'.repeat(501), REGEX).reason).toBe('tooComplex');
    expect(compareText('x'.repeat(20_001), 'x', REGEX).reason).toBe('tooComplex');
  });

  it('still accepts ordinary patterns', () => {
    expect(pass('abc123', '^[a-z]+\\d+$', REGEX)).toBe(true);
    expect(pass('ab', '^(a|b)+$', REGEX)).toBe(true);
    expect(pass('2024-01-05', '^(\\d{4})-(\\d{2})-(\\d{2})$', REGEX)).toBe(true);
    expect(pass('x', '(', REGEX)).toBe(false);
  });
});

describe('deep JSON', () => {
  it('compares nested lists to the depth cap, and fails beyond it without throwing', () => {
    const nest = (depth: number) => '['.repeat(depth) + ']'.repeat(depth);
    expect(compareJson(nest(100), nest(100), { mode: 'exact' }).pass).toBe(true);
    expect(compareJson(nest(5000), nest(5000), { mode: 'exact' }).pass).toBe(false);
    expect(showJson(nest(5000)).length).toBeGreaterThan(0);
  });
});
