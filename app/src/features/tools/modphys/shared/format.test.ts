import { describe, expect, it } from 'vitest';
import { prefixed } from './format';

describe('prefixed', () => {
  it('keeps SI prefixes inside their range', () => {
    expect(prefixed(8.9787e9, 'Hz')).toBe('8.9787 GHz');
    expect(prefixed(2.3508e-5, 'm')).toBe('23.508 µm');
  });

  it('falls back to scientific notation beyond tera and femto', () => {
    // The Sun's nominal luminosity (IAU 2015 B3) is 3.828×10²⁶ W, not 3.828×10¹⁴ TW.
    expect(prefixed(3.828e26, 'W')).toBe('3.828×10²⁶ W');
    expect(prefixed(2e-18, 's')).toBe('2×10⁻¹⁸ s');
  });
});
