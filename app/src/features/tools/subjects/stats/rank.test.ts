import { describe, expect, it } from 'vitest';
import { SubjectError } from '../errors';
import { cubicTieSum, kendallTieTerms, midRanks, rankGroups, tiedPairs } from './rank';

describe('mid-ranks', () => {
  it('ranks distinct values from 1', () => {
    expect(midRanks([30, 10, 20])).toEqual({ ranks: [3, 1, 2], ties: [] });
  });

  it('gives tied values the mean of their positions and reports each tie group', () => {
    // Sorted: 1, 2, 2, 3, 3, 3, 4 take positions 1..7; the 2s share 2.5 and the 3s share 5.
    const r = midRanks([3, 2, 4, 3, 1, 2, 3]);
    expect(r.ranks).toEqual([5, 2.5, 7, 5, 1, 2.5, 5]);
    expect(r.ties).toEqual([2, 3]);
    expect(r.ranks.reduce((s, x) => s + x, 0)).toBe((7 * 8) / 2);
  });

  it('sums the tie corrections by hand', () => {
    expect(cubicTieSum([2, 3])).toBe(6 + 24);
    expect(tiedPairs([2, 3])).toBe(1 + 3);
    expect(kendallTieTerms([2, 3])).toEqual({ v0: 2 * 9 + 6 * 11, v1: 0 + 6, v2: 2 + 6 });
  });

  it('ranks groups together and splits them back', () => {
    const { ranks, ties } = rankGroups([
      [1.1, 2.3],
      [2.0, 2.3, 9],
    ]);
    expect(ranks).toEqual([
      [1, 3.5],
      [2, 3.5, 5],
    ]);
    expect(ties).toEqual([2]);
  });

  it('handles an empty list and refuses values that are not numbers', () => {
    expect(midRanks([])).toEqual({ ranks: [], ties: [] });
    expect(() => midRanks([1, Number.NaN])).toThrow(SubjectError);
  });
});
