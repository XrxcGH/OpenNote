import { describe, expect, it } from 'vitest';
import { eng, fmt } from './shared';

describe('number display', () => {
  it('shows zero only for exact zero and keeps tiny numbers in scientific notation', () => {
    expect(fmt(0)).toBe('0');
    expect(fmt(2e-16)).toBe('2e-16');
    expect(fmt(-1.5e-26, 3)).toBe('−1.5e-26');
  });
  it('writes a rate as a power of ten, never as a prefix on 1/s', () => {
    expect(eng(12500, '1/s')).toBe('12.5 × 10³ s⁻¹');
    expect(eng(-20000, '1/s')).toBe('−20 × 10³ s⁻¹');
    expect(eng(300, '1/s')).toBe('300 s⁻¹');
    expect(eng(2e-3, '1/s')).toBe('2 × 10⁻³ s⁻¹');
    expect(eng(6283.2, 'rad/s', 4)).toBe('6.283 × 10³ rad/s');
  });
  it('still uses SI prefixes for ordinary units', () => {
    expect(eng(4700, 'Ω')).toBe('4.7 kΩ');
  });
});
