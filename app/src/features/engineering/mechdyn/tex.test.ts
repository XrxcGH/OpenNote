import './text';
import { describe, expect, it } from 'vitest';
import { tex } from './tex';

describe('numbers in worked-step LaTeX', () => {
  it('writes a power of ten with a times sign, not a tab', () => {
    const text = tex(2.5e-9);
    expect(text).not.toContain('\t');
    expect(text).toBe(String.raw`2.5 \times 10^{-9}`);
    expect(tex(1234.5678)).toBe('1234.6');
    expect(tex(0)).toBe('0');
  });
});
