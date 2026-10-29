import { describe, expect, it } from 'vitest';
import { filtersFor, NO_FILTERS } from './useSearchResults';

describe('Look in', () => {
  it('searches image blocks for descriptions and other blocks (the transcript text) for transcripts', () => {
    expect(filtersFor({ ...NO_FILTERS, type: 'alt' }).blockTypes).toEqual(['image']);
    expect(filtersFor({ ...NO_FILTERS, type: 'transcript' }).blockTypes).toEqual(['other']);
    expect(filtersFor(NO_FILTERS).blockTypes).toBeUndefined();
  });
});
