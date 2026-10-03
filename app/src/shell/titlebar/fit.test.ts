import { describe, expect, it } from 'vitest';
import { nextFit } from './fit';
import type { Fit } from './fit';

const start: Fit = { key: 'a', level: 0, needs: [] };
const range = { min: 0, max: 5 };

describe('nextFit', () => {
  it('steps up while the bar overflows, remembering the width each level needed', () => {
    const one = nextFit(start, { width: 700, overflow: 60 }, range);
    expect(one).toMatchObject({ level: 1, needs: [760] });
    const two = nextFit(one, { width: 700, overflow: 20 }, range);
    expect(two).toMatchObject({ level: 2, needs: [760, 720] });
  });

  it('keeps a level that fits, and the same object, so nothing renders again', () => {
    const fit: Fit = { key: 'a', level: 2, needs: [760, 720] };
    expect(nextFit(fit, { width: 710, overflow: 0 }, range)).toBe(fit);
  });

  it('steps down only once the lower level fits again', () => {
    const fit: Fit = { key: 'a', level: 2, needs: [760, 720] };
    expect(nextFit(fit, { width: 719, overflow: 0 }, range)).toBe(fit);
    expect(nextFit(fit, { width: 720, overflow: 0 }, range)).toMatchObject({ level: 1 });
  });

  it('never goes past the highest level or below the lowest', () => {
    const top: Fit = { key: 'a', level: 5, needs: [1, 2, 3, 4, 5] };
    expect(nextFit(top, { width: 100, overflow: 400 }, range)).toBe(top);
    expect(nextFit(start, { width: 2000, overflow: 0 }, { min: 1, max: 5 })).toMatchObject({ level: 1 });
    expect(nextFit(top, { width: 100, overflow: 0 }, { min: 0, max: 3 })).toMatchObject({ level: 3 });
  });

  it('ignores overflow under half a pixel, which rounding causes', () => {
    expect(nextFit(start, { width: 700, overflow: 0.4 }, range)).toBe(start);
  });
});
