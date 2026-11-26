// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { COPY_RANGES, parseCopies } from './backupNow';

describe('parseCopies', () => {
  it('takes whole numbers in range', () => {
    expect(parseCopies('7', COPY_RANGES.daily)).toBe(7);
    expect(parseCopies(' 0 ', COPY_RANGES.weekly)).toBe(0);
  });

  it('refuses negatives, fractions, huge numbers and numbers out of range', () => {
    for (const text of ['-3', '2.5', '9'.repeat(500), '999', '', 'abc']) {
      expect(parseCopies(text, COPY_RANGES.daily)).toBeNull();
    }
    expect(parseCopies('0', COPY_RANGES.daily)).toBeNull();
  });
});
