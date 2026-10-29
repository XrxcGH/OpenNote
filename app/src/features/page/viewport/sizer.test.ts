import { describe, expect, it } from 'vitest';
import { sizerWidth } from './viewport';

describe('the sizer width', () => {
  it('fits a world under a pixel wider than the viewport (150 percent rounding)', () => {
    expect(sizerWidth(753.4, 753)).toBe(753);
    expect(sizerWidth(693.33, 693)).toBe(693);
  });
  it('keeps a world a pixel or more wider, and one that fits', () => {
    expect(sizerWidth(754, 753)).toBe(754);
    expect(sizerWidth(793, 753)).toBe(793);
    expect(sizerWidth(600, 753)).toBe(600);
  });
});
