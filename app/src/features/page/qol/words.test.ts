import { describe, expect, it } from 'vitest';
import { countsOf, countWords, plainText, readingMinutes, tableText } from './words';

describe('word count', () => {
  it('counts words, not punctuation', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('  \n ')).toBe(0);
    expect(countWords('One, two - three!')).toBe(3);
    expect(countWords("Don't split well-known words")).toBe(4);
  });

  it('leaves out Markdown syntax and link addresses', () => {
    const text = plainText('# Title\n\n- [x] done *item*\n1. [a link](https://example.com) here\n![alt](a.png)\n---');
    expect(countWords(text)).toBe(6);
  });

  it('reads table cells', () => {
    const data = { rows: [{ cells: { a: { markdown: 'one two' }, b: { markdown: 'three' } } }] };
    expect(countWords(tableText(data))).toBe(3);
    expect(tableText({})).toBe('');
  });

  it('rounds the reading time and shows at least a minute for any text', () => {
    expect(readingMinutes(0)).toBe(0);
    expect(readingMinutes(5)).toBe(1);
    expect(readingMinutes(690)).toBe(3);
    expect(countsOf('a b c')).toEqual({ words: 3, minutes: 1 });
  });
});
