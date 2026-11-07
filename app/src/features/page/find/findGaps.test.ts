// Gaps found in review of Find and Replace. They cover zero-length matches at the paragraph mark and joining
// paragraphs with ^p. They also cover nested fixed counts, wildcards matching case, and any value of a format.
import { describe, expect, it } from 'vitest';
import { createMarkdownCache, parseTextBlock, serializeTextBlock } from '../../../editor/markdown';
import { criterionOf } from './format';
import { findInText, matchesInDoc, replaceInDoc } from './match';
import { isUnsafeRegex, patternProblem } from './pattern';

const loose = { caseSensitive: false, wholeWord: false };
const cache = createMarkdownCache();

describe('zero-length matches', () => {
  it('never gives a range that ends before it starts or lies past the text', () => {
    for (const query of ['$', '^', '.*', '\n?', 'x*', '(?=)']) {
      for (const text of ['abc', 'a', ' ']) {
        for (const { start, end } of findInText(text, query, { ...loose, regex: true })) {
          expect(start).toBeLessThanOrEqual(end);
          expect(end).toBeLessThanOrEqual(text.length);
        }
      }
    }
  });

  it('counts the matches of ^ $ and .* as the pattern defines them', () => {
    const regex = { ...loose, regex: true };
    expect(findInText('abc', '$', regex)).toEqual([]);
    expect(findInText('abc', '^', regex)).toEqual([]);
    expect(findInText('abc', '.*', regex).map(({ start, end }) => [start, end])).toEqual([[0, 3]]);
  });

  it('keeps the paragraph mark when the pattern asks for it', () => {
    expect(findInText('abc', '\n', { ...loose, regex: true }).map(({ start, end }) => [start, end])).toEqual([[3, 3]]);
  });

  it('keeps the number of paragraphs when $ or .* is replaced in all', () => {
    const doc = parseTextBlock('abc\n\ndef');
    const paragraphs = doc.childCount;
    for (const query of ['$', '.*', '^']) {
      const regex = { ...loose, regex: true };
      const next = replaceInDoc(doc, matchesInDoc(doc, query, regex), { text: 'X', options: regex });
      expect(next.childCount).toBe(paragraphs);
    }
  });
});

describe('the paragraph mark', () => {
  it('joins two paragraphs when ^p is replaced', () => {
    const doc = parseTextBlock('abc\n\ndef');
    const next = replaceInDoc(doc, matchesInDoc(doc, '^p', loose).slice(0, 1), { text: ' ', options: loose });
    expect(next.childCount).toBe(1);
    expect(next.textContent).toBe('abc def');
  });

  it('joins at "c^p", changing only the break when the text is kept', () => {
    const doc = parseTextBlock('abc\n\ndef');
    const next = replaceInDoc(doc, matchesInDoc(doc, 'c^p', loose), { text: 'Z', options: loose });
    expect(next.textContent).toBe('abZdef');
    expect(serializeTextBlock(next, cache)).toBe('abZdef');
  });
});

describe('patterns that take too long', () => {
  it('refuses a group that repeats inside, taken a fixed number of times', () => {
    expect(isUnsafeRegex('(.*a){12}c')).toBe(true);
    expect(isUnsafeRegex('(a|aa){25}c')).toBe(true);
    expect(isUnsafeRegex('(\\d{3}-)+')).toBe(false);
    expect(isUnsafeRegex('(a|b){2}')).toBe(false);
  });
});

describe('wildcards', () => {
  it('always match case, as the Match case switch cannot change them', () => {
    expect(findInText('Cat cat', 'cat', { ...loose, wildcards: true }).map(({ start }) => start)).toEqual([4]);
    expect(patternProblem('cat', { ...loose, wildcards: true })).toBeNull();
  });
});

describe('any format value', () => {
  it('finds any color or highlight with the any value', () => {
    expect(criterionOf('color', '*')).toEqual({ mark: 'textColor' });
    expect(criterionOf('highlight', '*')).toEqual({ mark: 'highlight' });
    expect(criterionOf('color', '')).toBeNull();
  });
});
