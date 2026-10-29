import { describe, expect, it } from 'vitest';
import { createMarkdownCache, parseTextBlock, serializeTextBlock } from '../../../editor/markdown';
import { findInText, matchesInDoc, replaceInDoc } from './match';

const loose = { caseSensitive: false, wholeWord: false };

describe('finding text', () => {
  it('finds every match, ignoring case unless asked', () => {
    expect(findInText('Cell cell CELL', 'cell', loose)).toHaveLength(3);
    expect(findInText('Cell cell CELL', 'cell', { ...loose, caseSensitive: true })).toEqual([{ start: 5, end: 9 }]);
  });

  it('matches whole words only when asked', () => {
    const text = 'cat concatenate cat.';
    expect(findInText(text, 'cat', loose)).toHaveLength(3);
    expect(findInText(text, 'cat', { ...loose, wholeWord: true })).toEqual([
      { start: 0, end: 3 },
      { start: 16, end: 19 },
    ]);
  });

  it('treats the query as text, not a pattern', () => {
    expect(findInText('1+1=2 and a.b', '1+1', loose)).toEqual([{ start: 0, end: 3 }]);
    expect(findInText('a.b axb', 'a.b', loose)).toEqual([{ start: 0, end: 3 }]);
    expect(findInText('anything', '', loose)).toEqual([]);
  });
});

describe('finding in a document', () => {
  const markdown = 'Mitosis in **mitosis** and\n\n# Mitosis notes\n\n- [ ] read mitosis';
  const cache = createMarkdownCache();

  it('lists matches per textblock with their positions', () => {
    const doc = parseTextBlock(markdown);
    const matches = matchesInDoc(doc, 'mitosis', loose);
    expect(matches.map((m) => m.textblock)).toEqual([0, 0, 1, 2]);
    for (const match of matches) expect(doc.textBetween(match.from, match.to).toLowerCase()).toBe('mitosis');
  });

  it('replaces every match in one document and keeps the formatting', () => {
    const doc = parseTextBlock(markdown);
    const next = replaceInDoc(doc, matchesInDoc(doc, 'mitosis', loose), 'meiosis');
    expect(serializeTextBlock(next, cache)).toBe('meiosis in **meiosis** and\n\n# meiosis notes\n\n- [ ] read meiosis');
  });

  it('removes the matches for an empty replacement', () => {
    const doc = parseTextBlock('a-b-c');
    expect(serializeTextBlock(replaceInDoc(doc, matchesInDoc(doc, '-', loose), ''), cache)).toBe('abc');
  });
});
