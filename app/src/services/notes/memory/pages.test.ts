// @vitest-environment node
// The page level helpers on plain arrays: blocks, validity, fitting inserted blocks, and clamping.

import { describe, expect, it } from 'vitest';
import { blockEnd, fitBlocks, levelsValid, normalized } from './pages';

describe('page levels', () => {
  it('finds the end of a page block', () => {
    expect(blockEnd([0, 1, 2, 0, 0], 0)).toBe(3);
    expect(blockEnd([0, 1, 2, 0, 0], 1)).toBe(3);
    expect(blockEnd([0, 1, 1, 0], 1)).toBe(2);
    expect(blockEnd([0], 0)).toBe(1);
  });

  it('checks the first page, each step down, and the deepest level', () => {
    expect(levelsValid([0, 1, 2, 0, 1])).toBe(true);
    expect(levelsValid([1, 0])).toBe(false);
    expect(levelsValid([0, 2])).toBe(false);
    expect(levelsValid([0, 1, 2, 3])).toBe(false);
    expect(levelsValid([])).toBe(true);
  });

  it('raises inserted blocks to fit and keeps their shape', () => {
    expect(fitBlocks(-1, [[1, 2]], undefined)).toEqual([[0, 1]]);
    expect(fitBlocks(0, [[2], [1, 2]], 0)).toEqual([[1], [1, 2]]);
    expect(fitBlocks(2, [[1]], 2)).toEqual([[1]]);
  });

  it('refuses to leave the next page too deep', () => {
    expect(fitBlocks(1, [[0]], 2)).toBeNull();
    expect(fitBlocks(-1, [[0]], 1)).toEqual([[0]]);
  });

  it('clamps each page to one level below the page before it', () => {
    expect(normalized([1, 2, 0, 2])).toEqual([0, 1, 0, 1]);
  });
});
