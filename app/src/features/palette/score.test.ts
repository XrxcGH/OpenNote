import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { normalize, score, scoreWithKeywords } from './score';

describe('score', () => {
  it('ranks a word start above the inside of a word above scattered letters', () => {
    const start = score('dark', 'Toggle dark mode');
    const inside = score('ark', 'Toggle dark mode');
    const scattered = score('tdm', 'Toggle dark mode');
    expect(start).toBeGreaterThan(inside);
    expect(inside).toBeGreaterThan(scattered);
    expect(scattered).toBeGreaterThan(0);
  });

  it('needs every word, in any order, and ranks the exact title first', () => {
    expect(score('mode dark', 'Toggle dark mode')).toBeGreaterThan(0);
    expect(score('dark light', 'Toggle dark mode')).toBe(0);
    expect(score('toggle dark mode', 'Toggle dark mode')).toBeGreaterThan(score('toggle dark', 'Toggle dark mode'));
  });

  it('ignores accents and case, and matches everything when nothing is typed', () => {
    expect(score('cafe', 'Café notes')).toBeGreaterThan(0);
    expect(normalize('ÉCOLE')).toBe('ecole');
    expect(score('  ', 'Anything')).toBe(1);
  });

  it('counts extra search words a little lower than the title', () => {
    expect(scoreWithKeywords('prefs', 'Open settings', 'preferences options')).toBeGreaterThan(0);
    expect(scoreWithKeywords('prefs', 'Open settings', 'preferences options')).toBeLessThan(
      scoreWithKeywords('open', 'Open settings', 'preferences options'),
    );
  });

  it('matches any text against itself, and never scores below zero', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 20 }), fc.string({ maxLength: 30 }), (query, text) => {
        expect(score(query, text)).toBeGreaterThanOrEqual(0);
        if (normalize(query).trim()) expect(score(query, query)).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });
});
