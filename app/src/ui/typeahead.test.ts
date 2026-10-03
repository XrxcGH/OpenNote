import { describe, expect, it } from 'vitest';
import { typeaheadMatch } from './typeahead';

const PAGES = ['Cell structure', 'membranes', 'Mitosis', 'Meiosis', 'Émile notes', 'photosynthesis'];

describe('typeaheadMatch', () => {
  it('ignores case', () => {
    expect(typeaheadMatch(PAGES, 0, 'P')).toBe(5);
    expect(typeaheadMatch(PAGES, 0, 'c')).toBe(0);
  });

  it('ignores accents on both sides', () => {
    expect(typeaheadMatch(PAGES, 0, 'emi')).toBe(4);
    expect(typeaheadMatch(['Cafe', 'Café au lait'], 0, 'café a')).toBe(1);
  });

  it('starts after the current item and wraps around', () => {
    expect(typeaheadMatch(PAGES, 5, 'c')).toBe(0);
    expect(typeaheadMatch(PAGES, 2, 'm')).toBe(3);
  });

  it('cycles through items when the same letter repeats', () => {
    expect(typeaheadMatch(PAGES, 1, 'm')).toBe(2);
    expect(typeaheadMatch(PAGES, 2, 'mm')).toBe(3);
    expect(typeaheadMatch(PAGES, 3, 'mmm')).toBe(1);
  });

  it('keeps the current item while a longer prefix still matches it', () => {
    expect(typeaheadMatch(PAGES, 2, 'mi')).toBe(2);
    expect(typeaheadMatch(PAGES, 2, 'mei')).toBe(3);
  });

  it('returns -1 when nothing matches', () => {
    expect(typeaheadMatch(PAGES, 0, 'z')).toBe(-1);
    expect(typeaheadMatch([], 0, 'a')).toBe(-1);
    expect(typeaheadMatch(PAGES, 0, '')).toBe(-1);
  });
});
