import { describe, expect, it } from 'vitest';
import { createMarkdownCache, parseTextBlock, serializeTextBlock } from '../../../editor/markdown';
import { isUnsafeRegex, MAX_PATTERN_LENGTH, patternProblem } from './pattern';
import { findInText, matchesInDoc, replaceInDoc } from './match';

const loose = { caseSensitive: false, wholeWord: false };
const cache = createMarkdownCache();
const bold = [{ mark: 'bold' }];

describe('regular expressions', () => {
  it('finds c[ae]ll as a pattern only when asked', () => {
    const text = 'a cell and a call';
    expect(findInText(text, 'c[ae]ll', { ...loose, regex: true })).toHaveLength(2);
    expect(findInText(text, 'c[ae]ll', loose)).toEqual([]);
  });

  it('refuses a pattern that repeats a repeated part, on a long paragraph, at once', () => {
    const text = `${'a'.repeat(10_000)}b`;
    const options = { ...loose, regex: true };
    const started = performance.now();
    expect(patternProblem('(a+)+$', options)).toBe('unsafe');
    expect(findInText(text, '(a+)+$', options)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('limits the length of a pattern and reports an invalid one', () => {
    const options = { ...loose, regex: true };
    expect(patternProblem('a'.repeat(MAX_PATTERN_LENGTH + 1), options)).toBe('tooLong');
    expect(patternProblem('(a', options)).toBe('invalid');
    expect(patternProblem('a+b', options)).toBeNull();
  });

  it('knows which repeats are safe', () => {
    expect(isUnsafeRegex('(\\d{3},)+')).toBe(false);
    expect(isUnsafeRegex('(?:ab)+')).toBe(false);
    expect(isUnsafeRegex('(a*)*')).toBe(true);
    expect(isUnsafeRegex('((a)|(b))*')).toBe(false);
    expect(isUnsafeRegex('[(a+)+]')).toBe(false);
  });

  it('puts the groups in the replacement', () => {
    const doc = parseTextBlock('John Smith');
    const options = { ...loose, regex: true };
    const matches = matchesInDoc(doc, '(\\w+) (\\w+)', options);
    const next = replaceInDoc(doc, matches, { text: '$2, $1', options });
    expect(serializeTextBlock(next, cache)).toBe('Smith, John');
  });
});

describe('wildcards', () => {
  const options = { ...loose, wildcards: true };
  it('reads ?, *, sets, and word edges', () => {
    expect(findInText('cat cot cut', 'c?t', options)).toHaveLength(3);
    expect(findInText('cat cot cut', 'c[!o]t', options)).toHaveLength(2);
    expect(findInText('start of the end', '<s*t>', options).map((m) => m.end - m.start)).toEqual([5]);
    expect(findInText('aaa a', 'a{2}', options).map((m) => [m.start, m.end])).toEqual([[0, 2]]);
  });

  it('reports a malformed wildcard', () => {
    expect(patternProblem('[abc', options)).toBe('invalid');
    expect(patternProblem('a{x}', options)).toBe('invalid');
  });

  it('uses \\1 in the replacement', () => {
    const doc = parseTextBlock('one two');
    const matches = matchesInDoc(doc, '(one) (two)', options);
    expect(serializeTextBlock(replaceInDoc(doc, matches, { text: '\\2 \\1', options }), cache)).toBe('two one');
  });
});

describe('special characters', () => {
  it('finds ^t, ^s, ^#, ^$, ^? and ^^', () => {
    expect(findInText('a\tb\tc', '^t', loose)).toHaveLength(2);
    expect(findInText('a\u00a0b', '^s', loose)).toHaveLength(1);
    expect(findInText('a1b22', '^#', loose)).toHaveLength(3);
    expect(findInText('a1b', '^$', loose)).toHaveLength(2);
    expect(findInText('a1', '^?', loose)).toHaveLength(2);
    expect(findInText('a^b', 'a^^b', loose)).toHaveLength(1);
  });

  it('finds a manual line break and the paragraph mark', () => {
    const doc = parseTextBlock('one  \ntwo\n\nthree');
    expect(matchesInDoc(doc, '^l', loose)).toHaveLength(1);
    expect(matchesInDoc(doc, '^p', loose)).toHaveLength(2);
    expect(findInText('end', 'd^p', loose).map((m) => [m.start, m.end])).toEqual([[2, 3]]);
  });

  it('writes a tab and a line break in a replacement', () => {
    const doc = parseTextBlock('a-b');
    const next = replaceInDoc(doc, matchesInDoc(doc, '-', loose), { text: '^t^l', options: loose });
    expect(next.textContent).toBe('a\tb');
    expect(next.firstChild?.childCount).toBe(3);
  });
});

describe('formats', () => {
  const markdown = 'cell **cell** cell';

  it('finds bold cell and no other', () => {
    const doc = parseTextBlock(markdown);
    expect(matchesInDoc(doc, 'cell', loose)).toHaveLength(3);
    const found = matchesInDoc(doc, 'cell', loose, bold);
    expect(found).toHaveLength(1);
    expect(found[0].start).toBe(5);
  });

  it('finds a font, a size, and a color by value', () => {
    const doc = parseTextBlock('a <span data-color="brick">b</span> <span data-size="14">c</span>');
    expect(matchesInDoc(doc, '', loose, [{ mark: 'textColor', attrs: { color: 'brick' } }])).toHaveLength(1);
    expect(matchesInDoc(doc, '', loose, [{ mark: 'textColor', attrs: { color: 'fern' } }])).toHaveLength(0);
    expect(matchesInDoc(doc, 'c', loose, [{ mark: 'textSize', attrs: { size: '14' } }])).toHaveLength(1);
  });

  it('finds the runs that have a format when there is no text', () => {
    const doc = parseTextBlock('a **b** c **d**');
    expect(matchesInDoc(doc, '', loose, bold).map((m) => [m.start, m.end])).toEqual([
      [2, 3],
      [6, 7],
    ]);
  });

  it('sets a color on the replacement and changes nothing else', () => {
    const doc = parseTextBlock(markdown);
    const found = matchesInDoc(doc, 'cell', loose, bold);
    const next = replaceInDoc(doc, found, {
      text: 'cell',
      formats: [{ mark: 'textColor', attrs: { color: 'brick' } }],
    });
    expect(next.textContent).toBe('cell cell cell');
    const out = serializeTextBlock(next, cache);
    expect(out).toContain('data-color="brick"');
    expect(out.startsWith('cell ')).toBe(true);
    expect(out.endsWith(' cell')).toBe(true);
    expect(out.match(/data-color/g)).toHaveLength(1);
  });

  it('keeps the text and sets the format when the replacement text is null', () => {
    const doc = parseTextBlock('a b');
    const next = replaceInDoc(doc, matchesInDoc(doc, 'b', loose), { text: null, formats: bold });
    expect(serializeTextBlock(next, cache)).toBe('a **b**');
  });

  it('leaves out a value outside the grammar', () => {
    const doc = parseTextBlock('a b');
    const next = replaceInDoc(doc, matchesInDoc(doc, 'b', loose), {
      text: null,
      formats: [{ mark: 'textColor', attrs: { color: 'url(x)' } }],
    });
    expect(serializeTextBlock(next, cache)).toBe('a b');
  });
});
