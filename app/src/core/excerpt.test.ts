import { describe, expect, it } from 'vitest';
import { after, before, excerpt } from './excerpt';

describe('excerpt', () => {
  it('keeps short text whole and cuts long text between words', () => {
    expect(excerpt('a short line', 40)).toBe('a short line');
    expect(excerpt('Budget was twelve thousand dollars, with a contingency', 33)).toBe(
      'Budget was twelve thousand\u2026',
    );
  });

  it('cuts context before and after a match between words', () => {
    const text = 'one two three four five six seven';
    expect(after(text, 9, 12)).toBe('three four\u2026');
    expect(before(text, 19, 9)).toBe('\u2026four ');
    expect(after(text, 28, 12)).toBe('seven');
    expect(before(text, 3, 9)).toBe('one');
  });
});
