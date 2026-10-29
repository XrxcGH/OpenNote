import { describe, expect, it } from 'vitest';
import { isKnownTag, normalizeTag, tagForSlot, tagName } from './defs';

describe('line tag definitions', () => {
  it('puts the OneNote tags on Ctrl+1 to Ctrl+9', () => {
    expect([1, 2, 3, 4].map(tagForSlot)).toEqual(['todo', 'important', 'question', 'idea']);
    expect(tagForSlot(9)).toBe('phone');
  });

  it('normalizes custom names like page tags', () => {
    expect(normalizeTag('  #Follow Up/Mom ')).toBe('follow up/mom');
    expect(normalizeTag('#')).toBe('');
  });

  it('names known tags in words and leaves custom ones as typed', () => {
    expect(isKnownTag('idea')).toBe(true);
    expect(tagName('idea')).toBe('Idea');
    expect(tagName('follow up')).toBe('follow up');
  });
});
