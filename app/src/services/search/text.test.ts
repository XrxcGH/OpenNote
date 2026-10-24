import { describe, expect, it } from 'vitest';
import { fold, linkFor, parseLinks, pieces, plainText, toByteRange, toStringRanges } from './text';

describe('search text helpers', () => {
  it('folds case and accents', () => {
    expect(fold('Café ÉCOLE')).toBe('cafe ecole');
  });

  it('turns byte ranges into string ranges around multi-byte characters', () => {
    const text = 'é😀 cell';
    const range = toByteRange(text, text.indexOf('cell'), text.length);
    expect(range).toEqual({ start: 7, end: 11 });
    expect(toStringRanges(text, [range])).toEqual([{ start: 4, end: 8 }]);
    // A range that splits a character is dropped, not guessed.
    expect(toStringRanges(text, [{ start: 1, end: 2 }])).toEqual([]);
  });

  it('cuts text at the highlights', () => {
    expect(pieces('a cell wall', [{ start: 2, end: 6 }])).toEqual([
      { text: 'a ', match: false },
      { text: 'cell', match: true },
      { text: ' wall', match: false },
    ]);
    expect(pieces('plain', [])).toEqual([{ text: 'plain', match: false }]);
  });

  it('reads page links with headings, and not inside code', () => {
    const links = parseLinks('See [[Cell]] and [[Cell#Organelles]] but not `[[Code]]` or [[ ]] or [[a]b]].');
    expect(links.map((link) => [link.title, link.heading, link.raw])).toEqual([
      ['Cell', null, '[[Cell]]'],
      ['Cell', 'Organelles', '[[Cell#Organelles]]'],
    ]);
    expect(links[0].start).toBe(4);
  });

  it('reads links the way the page stores them, with every bracket escaped', () => {
    const links = parseLinks('See \\[\\[Cell\\]\\] and \\[\\[Cell#Organelles\\]\\] and [[Plain]].');
    expect(links.map((link) => [link.title, link.heading, link.raw])).toEqual([
      ['Cell', null, '\\[\\[Cell\\]\\]'],
      ['Cell', 'Organelles', '\\[\\[Cell#Organelles\\]\\]'],
      ['Plain', null, '[[Plain]]'],
    ]);
    // A rewrite keeps the spelling it found.
    expect(linkFor('New', null, '\\[\\[Cell\\]\\]')).toBe('\\[\\[New\\]\\]');
    expect(linkFor('New', 'Head', '[[Cell#Head]]')).toBe('[[New#Head]]');
    expect(plainText('See \\[\\[Cell\\]\\] and \\#tag')).toBe('See Cell and #tag');
  });

  it('writes a link that reads back as the same title', () => {
    for (const title of ['Cell', 'C# notes', 'a]]b', 'Café']) {
      const [link] = parseLinks(linkFor(title));
      expect(link.heading).toBeNull();
      expect(fold(link.title)).toBe(fold(title.replace(/[[\]]/g, '').replace(/#/g, '')));
    }
    expect(linkFor('Cell', 'Organelles')).toBe('[[Cell#Organelles]]');
  });

  it('gives the words of Markdown without its marks', () => {
    expect(plainText('## **Bold** and [[Page#Head]] and [text](https://x.org)')).toBe('Bold and Page and text');
    expect(plainText('- [ ] a task')).toBe('a task');
  });
});
