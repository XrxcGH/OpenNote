import { describe, expect, it } from 'vitest';
import { plainTextOf } from './plainText';

const bytes = (...values: number[]) => new Uint8Array(values);

describe('plainTextOf', () => {
  it('reads UTF-8 text with tabs and line breaks', () => {
    const text = 'front\tback\r\ncaf\u00e9\tcoffee\n';
    expect(plainTextOf(new TextEncoder().encode(text))).toBe(text);
  });

  it('refuses bytes that are not valid UTF-8', () => {
    expect(plainTextOf(bytes(0xff, 0xfe, 0x41, 0x80))).toBeNull();
  });

  it('refuses text that holds a NUL or another control character', () => {
    expect(plainTextOf(bytes(0x61, 0x00, 0x62))).toBeNull();
    expect(plainTextOf(bytes(0x61, 0x1b, 0x62))).toBeNull();
  });

  it('refuses a binary file of pseudo-random bytes', () => {
    expect(plainTextOf(Uint8Array.from({ length: 4096 }, (_, i) => (i * 131 + 17) % 256))).toBeNull();
  });
});
