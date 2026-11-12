// The match mode 3 matcher. The expected answers come from the built-in engine, which follows the ECMAScript
// specification, on patterns and texts small enough that it cannot backtrack for long.

import { describe, expect, it } from 'vitest';
import { regexMatcher } from './lookupRegex';

const PATTERNS = [
  '',
  'abc',
  '^ba',
  'na$',
  '^$',
  'a|b|cd',
  '(a|aa)+$',
  '(a+)+b',
  '^(a|b)*c?$',
  'colou?r',
  'a{2}',
  'a{2,3}$',
  '^a{2,}$',
  '(?:ab){1,2}c',
  '(?<word>x)y',
  '[a-c]+d',
  '[^0-9]',
  String.raw`[\]]`,
  String.raw`\d{3}-\d{4}`,
  String.raw`\w+@\w+\.com`,
  String.raw`\s`,
  String.raw`\bcat\b`,
  String.raw`\Bat`,
  'x.z',
  String.raw`\u0041`,
  String.raw`\u{1F600}`,
  String.raw`\uD83D\uDE00`,
  String.raw`\x41`,
  String.raw`\p{Lu}`,
  String.raw`\cJ`,
  String.raw`[\d.]+`,
  '😀+',
  'a*?b',
  '(a*)*$',
  '(|a)+b',
];
const TEXTS = ['', 'abc', 'banana', 'cd', 'aaab', 'aaa', 'ab', 'abbc', 'color', 'colour', 'aaaa', 'ababc', 'xy'];
const MORE = [
  'bd',
  '7',
  'q]',
  '555-1234',
  'me@site.com',
  'a b',
  'concat',
  'a cat',
  'bat',
  'x\nz',
  'xyz',
  'A',
  '😀😀',
  'aab',
];

describe('match mode 3 matcher', () => {
  it('agrees with the built-in engine', () => {
    for (const pattern of PATTERNS) {
      const ours = regexMatcher(pattern);
      expect(ours, pattern).not.toBeNull();
      const re = new RegExp(pattern, 'u');
      for (const text of [...TEXTS, ...MORE]) expect(ours?.(text), `${pattern} on ${text}`).toBe(re.test(text));
    }
  });

  it('refuses back references, lookaround, and patterns that are not valid', () => {
    for (const pattern of ['(a)\\1', '(?<n>a)\\k<n>', 'a(?=b)', 'a(?!b)', '(?<=a)b', '(?<!a)b', '(', 'a**', '\\']) {
      expect(regexMatcher(pattern), pattern).toBeNull();
    }
  });

  it('refuses a pattern that writes out to too large a program', () => {
    expect(regexMatcher('(a{100}){100}')).toBeNull();
    expect(regexMatcher('a'.repeat(1001))).toBeNull();
  });

  it('stays fast on patterns that make a backtracking engine take exponential time', () => {
    const text = `${'a'.repeat(5000)}!`;
    const start = performance.now();
    for (const pattern of ['(a|aa)+$', '(a+)+$', '(a*)*b', '^(a?){30}a{30}$', '(.*a){12}$']) {
      expect(regexMatcher(pattern)?.(text), pattern).toBe(false);
    }
    expect(performance.now() - start).toBeLessThan(2000);
  });
});
