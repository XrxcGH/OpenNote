import { describe, expect, it } from 'vitest';
import { addTerm, countTerms, formatVocabulary, parseVocabulary, removeTerm, vocabularyFile } from './list';

describe('the vocabulary text', () => {
  it('reads terms, mishearings, and notes the way the crate does', () => {
    const entries = parseVocabulary('# Biology\nATP\nCalvin cycle | calvin psyche, kelvin cycle\n\natp | adenosine\n');
    expect(entries).toEqual([
      { term: 'ATP', heardAs: ['adenosine'] },
      { term: 'Calvin cycle', heardAs: ['calvin psyche', 'kelvin cycle'] },
    ]);
  });

  it('skips lines with no letters and mishearings that equal the term', () => {
    expect(parseVocabulary('---\n123 | 456\nName | name\n')).toEqual([
      { term: '123', heardAs: ['456'] },
      { term: 'Name', heardAs: [] },
    ]);
  });

  it('writes what it reads', () => {
    const text = 'ATP\nCalvin cycle | calvin psyche, kelvin cycle\n';
    expect(formatVocabulary(parseVocabulary(text))).toBe(text);
    expect(countTerms(text)).toBe(2);
  });
});

describe('adding and removing terms', () => {
  it('adds a new term at the end and keeps notes', () => {
    expect(addTerm('# Course\nATP\n', 'Priya  Raghunathan', 'pria ragu')).toBe(
      '# Course\nATP\nPriya Raghunathan | pria ragu\n',
    );
  });

  it('adds a mishearing to the line of a term that is already listed, ignoring case', () => {
    expect(addTerm('ATP\n', 'atp', 'a t p')).toBe('ATP | a t p\n');
    expect(addTerm('ATP | a t p\n', 'ATP', 'A T P')).toBe('ATP | a t p\n');
  });

  it('ignores a term with no letters or one that is too long', () => {
    expect(addTerm('ATP\n', '--')).toBe('ATP\n');
    expect(addTerm('ATP\n', 'x'.repeat(81))).toBe('ATP\n');
  });

  it('removes a term and leaves the rest', () => {
    expect(removeTerm('# Note\nATP | a t p\nGolgi\n', 'atp')).toBe('# Note\nGolgi\n');
  });
});

describe('where a list is kept', () => {
  it('names a file for each notebook and one for all of them', () => {
    expect(vocabularyFile('nb_1')).toBe('vocabulary-nb_1.txt');
    expect(vocabularyFile(null)).toBe('vocabulary-all.txt');
  });

  it('keeps an ID from leaving the store', () => {
    expect(vocabularyFile('../x/y')).toBe('vocabulary-___x_y.txt');
  });
});
