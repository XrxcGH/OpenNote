import { describe, expect, it } from 'vitest';
import { draftFromText } from './altDraft';

describe('alt text draft', () => {
  it('joins recognized lines into one tidy line', () => {
    expect(draftFromText('Mitosis  phases\n\n  Prophase\r\nMetaphase \n', 200)).toBe(
      'Mitosis phases Prophase Metaphase',
    );
  });

  it('cuts a long draft at the limit', () => {
    const draft = draftFromText('word '.repeat(100), 50);
    expect(draft).toHaveLength(50);
    expect(draft.endsWith('…')).toBe(true);
  });

  it('leaves nothing for empty text', () => {
    expect(draftFromText(' \n ', 10)).toBe('');
  });
});
