import { describe, expect, it } from 'vitest';
import { lengthClock } from './format';

describe('lengthClock', () => {
  it('rounds a length to the nearest second and never shows 0:00 for sound', () => {
    expect(lengthClock(4000)).toBe('0:04');
    expect(lengthClock(3600)).toBe('0:04');
    expect(lengthClock(470)).toBe('0:01');
    expect(lengthClock(0)).toBe('0:00');
  });
});
