// Gaps found in review of Find and Replace. They cover zero-length matches at the paragraph mark and joining
// paragraphs with ^p. They also cover nested fixed counts, wildcards matching case, and any value of a format.
import { describe, expect, it } from 'vitest';
import { createMarkdownCache, parseTextBlock, serializeTextBlock } from '../../../editor/markdown';
import { criterionOf } from './format';
import { findInText, matchesInDoc, replaceInDoc } from './match';
import type { FindOptions } from './match';
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

describe('the paragraph mark is searched only when named', () => {
  const regex = { ...loose, regex: true };
  const wild = { ...loose, wildcards: true };
  const replaceAll = (
    doc: ReturnType<typeof parseTextBlock>,
    query: string,
    text: string,
    options: FindOptions = regex,
  ) => replaceInDoc(doc, matchesInDoc(doc, query, options), { text, options });

  it('keeps the paragraph count when \\s+ is replaced in all', () => {
    const doc = parseTextBlock('a b\n\nc d\n\ne f');
    const next = replaceAll(doc, '\\s+', ' ');
    expect(next.childCount).toBe(3);
    expect(next.textContent).toBe('a bc de f');
  });

  it('does not let [^x]+ or a wildcard class take the mark', () => {
    expect(findInText('ab', '[^x]+', regex).map(({ start, end }) => [start, end])).toEqual([[0, 2]]);
    expect(findInText('ab', '[!x]@', wild).map(({ start, end }) => [start, end])).toEqual([[0, 2]]);
    const doc = parseTextBlock('ab\n\ncd');
    expect(replaceAll(doc, '[!x]@', 'Z', wild).childCount).toBe(2);
  });

  it('still finds the mark when the query names it', () => {
    expect(findInText('ab', '\\n', regex)).toHaveLength(1);
    expect(findInText('ab', 'b^p', loose)).toHaveLength(1);
  });

  it('never adds text for the mark of the last paragraph', () => {
    const doc = parseTextBlock('a\n\nb');
    const next = replaceAll(doc, '^p', '!', loose);
    expect(next.textContent).toBe('a!b');
  });
});

describe('empty paragraphs', () => {
  it('finds the mark of an empty paragraph and removes the paragraph when ^p is replaced by nothing', () => {
    const { schema } = parseTextBlock('x').type;
    const paragraph = (text: string) => schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
    const doc = schema.topNodeType.create(null, [paragraph('a'), paragraph(''), paragraph('b')]);
    const matches = matchesInDoc(doc, '^p', loose);
    expect(matches.map((m) => m.from)).toEqual([2, 4, 7]);
    const empty = matches.filter((match) => match.from === 4);
    const next = replaceInDoc(doc, empty, { text: '', options: loose });
    expect(next.childCount).toBe(2);
    expect(next.textContent).toBe('ab');
  });
});

describe('^p in the replacement', () => {
  it('splits the paragraph at each ^p', () => {
    const doc = parseTextBlock('a, b, c');
    const next = replaceInDoc(doc, matchesInDoc(doc, ', ', loose), { text: '^p', options: loose });
    expect(next.childCount).toBe(3);
    expect(next.child(1).textContent).toBe('b');
  });

  it('keeps text around a ^p', () => {
    const doc = parseTextBlock('a-b');
    const next = replaceInDoc(doc, matchesInDoc(doc, '-', loose), { text: 'x^py', options: loose });
    expect(next.childCount).toBe(2);
    expect([next.child(0).textContent, next.child(1).textContent]).toEqual(['ax', 'yb']);
  });
});

describe('common repeated groups are allowed', () => {
  it('accepts alternation and word repeats and refuses only a repeated repeat', () => {
    for (const source of ['(cat|dog)+', '(\\w+\\s)+', '(\\d+,)*\\d+', '(?:a|b)*', '(ab|cd){2,3}'])
      expect(isUnsafeRegex(source), source).toBe(false);
    for (const source of ['(a+)+', '(a*)*', '(?:\\w+)*', '([ab]+)+']) expect(isUnsafeRegex(source), source).toBe(true);
  });
});
