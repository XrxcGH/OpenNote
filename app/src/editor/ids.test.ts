import { describe, expect, it } from 'vitest';
import { isId, newId } from './ids';

describe('IDs (SPEC 2.4)', () => {
  it('are 26 lowercase Crockford base32 characters that start with 0 to 7', () => {
    for (let i = 0; i < 50; i++) expect(isId(newId())).toBe(true);
  });

  it('sort by time, and encode the millisecond time in the first 10 characters', () => {
    const zero = (bytes: Uint8Array<ArrayBuffer>) => bytes;
    expect(newId(0, zero)).toBe(`${'0'.repeat(10)}${'0'.repeat(16)}`);
    expect(newId(1, zero).slice(0, 10)).toBe('0000000001');
    expect(newId(32, zero).slice(0, 10)).toBe('0000000010');
    expect(newId(1_700_000_000_000, zero) < newId(1_700_000_000_001, zero)).toBe(true);
  });

  it('refuses the letters i, l, o, and u, and any other length', () => {
    expect(isId('01m3sabc31y0rfa24eeh6j4ky4')).toBe(true);
    expect(isId('01m3sabc31y0rfa24eeh6j4kyi')).toBe(false);
    expect(isId('01m3sabc31y0rfa24eeh6j4k')).toBe(false);
    expect(isId('81m3sabc31y0rfa24eeh6j4ky4')).toBe(false);
  });
});
