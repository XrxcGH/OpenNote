import { describe, expect, it } from 'vitest';
import { alternateSpans } from './marks';
import { syllables } from './syllables';

const picked = (text: string) => alternateSpans(text).map((span) => text.slice(span.start, span.end));

describe('syllable marks', () => {
  it('marks every second syllable of a long word', () => {
    const parts = syllables('reading');
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(picked('reading')).toEqual(parts.filter((_, i) => i % 2 === 1));
  });

  it('points into the text where the syllable really is', () => {
    const text = 'A wonderful, remarkable afternoon.';
    for (const span of alternateSpans(text)) {
      const piece = text.slice(span.start, span.end);
      expect(piece).toMatch(/^[A-Za-z]+$/);
      expect(span.end).toBeGreaterThan(span.start);
    }
    expect(alternateSpans(text).length).toBeGreaterThan(2);
  });

  it('leaves short words, numbers, addresses, and paths alone', () => {
    expect(picked('the cat sat')).toEqual([]);
    expect(picked('notebook2 hello@example.com C:\\Users\\someone #hashtag')).toEqual([]);
  });

  it('leaves other languages whole', () => {
    expect(alternateSpans('Wunderbare Nachmittage', 'de')).toEqual([]);
  });

  it('never changes what the text says: the spans lie inside it, in order, without overlap', () => {
    const text = 'Reading aids help students concentrate on unfamiliar vocabulary during examinations.';
    let last = 0;
    for (const span of alternateSpans(text)) {
      expect(span.start).toBeGreaterThanOrEqual(last);
      expect(span.end).toBeLessThanOrEqual(text.length);
      last = span.end;
    }
  });
});
