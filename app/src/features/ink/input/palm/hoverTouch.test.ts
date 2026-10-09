// T2-11: with the pen only hovering, the other hand scrolls and pans away from the writing hand; touch under the
// writing hand's rest area is held back on purpose (palm-rejection.md step 4 names the other hand).

import { describe, expect, it } from 'vitest';
import { Fx } from './effects';
import { down, effects, filter, move, pen } from './fixtures';

const FAR = [40, 80] as const;

describe('touch while the pen hovers', () => {
  it('scrolls with one finger of the other hand', () => {
    const f = filter();
    pen(f, 'hover', 0);
    expect(down(f, 1, 20, ...FAR)).toBe('scroll');
    let started = false;
    for (let t = 40; t < 300; t += 16) {
      pen(f, 'hover', t);
      move(f, 1, t, FAR[0], FAR[1] - (t - 20) / 8);
      started ||= effects(f).some((e) => (e.fx & Fx.Start) !== 0);
    }
    expect(started).toBe(true);
  });

  it('pans with two fingers of the other hand', () => {
    const f = filter();
    pen(f, 'hover', 0);
    down(f, 1, 20, ...FAR);
    expect(down(f, 2, 60, FAR[0] - 20, FAR[1])).toBe('nav');
  });

  it('holds back a finger 19 mm right and 58 mm below the hovering pen, where the writing hand rests (T2-11)', () => {
    const f = filter();
    pen(f, 'hover', 0, 173, 96);
    expect(down(f, 1, 20, 192, 154)).toBe('scroll');
    let started = false;
    for (let t = 40; t < 300; t += 16) {
      pen(f, 'hover', t, 173, 96);
      move(f, 1, t, 192, 154 - (t - 20) / 8);
      started ||= effects(f).some((e) => (e.fx & Fx.Start) !== 0);
    }
    expect(started).toBe(false);
  });
});
