import { describe, expect, it } from 'vitest';
import {
  complementSet,
  forteClasses,
  forteName,
  intervalVector,
  invertSet,
  isRow,
  normalForm,
  primeForm,
  rowInversion,
  rowMatrix,
  rowRetrograde,
  transposeSet,
  zMate,
} from './pcset';

describe('pitch-class sets', () => {
  it('gives the prime form, Forte name, and vector of the major triad', () => {
    expect(primeForm([0, 4, 7])).toEqual([0, 3, 7]);
    expect(forteName([0, 4, 7])).toBe('3-11');
    expect(intervalVector([0, 4, 7]).join('')).toBe('001110');
  });
  it('gives the same for the minor triad and any transposition', () => {
    expect(primeForm([9, 0, 4])).toEqual([0, 3, 7]);
    expect(forteName([2, 5, 9])).toBe('3-11');
  });
  it('gives (014), 3-3, <101100> for {0, 1, 4}', () => {
    expect(primeForm([0, 1, 4])).toEqual([0, 1, 4]);
    expect(forteName([0, 1, 4])).toBe('3-3');
    expect(intervalVector([0, 1, 4]).join('')).toBe('101100');
  });
  it('writes the normal form of a set that wraps past 12', () => {
    expect(normalForm([10, 0, 4])).toEqual([10, 0, 4]);
    expect(normalForm([0, 4, 7])).toEqual([0, 4, 7]);
    expect(normalForm([7, 0, 4])).toEqual([0, 4, 7]);
  });
  it('knows the dominant seventh is 4-27 with vector <012111>', () => {
    expect(forteName([7, 11, 2, 5])).toBe('4-27');
    expect(intervalVector([7, 11, 2, 5]).join('')).toBe('012111');
  });
  it('names the whole-tone scale 6-35 and the chromatic cluster 3-1', () => {
    expect(forteName([0, 2, 4, 6, 8, 10])).toBe('6-35');
    expect(forteName([5, 6, 7])).toBe('3-1');
  });
  it('transposes, inverts, and complements', () => {
    expect(transposeSet([0, 4, 7], 5)).toEqual([0, 5, 9]);
    expect(invertSet([0, 4, 7], 7)).toEqual([0, 3, 7]);
    expect(complementSet([0, 2, 4, 5, 7, 9, 11])).toEqual([1, 3, 6, 8, 10]);
  });
  it('finds the Z-relative of 4-Z15 as 4-Z29', () => {
    expect(zMate([0, 1, 4, 6])?.name).toBe('4-Z29');
    expect(intervalVector([0, 1, 4, 6]).join('')).toBe(intervalVector([0, 1, 3, 7]).join(''));
  });
  it('handles an empty set and a repeated note', () => {
    expect(primeForm([])).toEqual([]);
    expect(primeForm([4, 4, 16])).toEqual([0]);
  });
});

describe('the table of set classes', () => {
  it('has every class the theory counts, once each', () => {
    const counts = new Map<number, number>();
    for (const c of forteClasses()) counts.set(c.prime.length, (counts.get(c.prime.length) ?? 0) + 1);
    // Cardinalities 0 to 12 hold 1, 1, 6, 12, 29, 38, 50, 38, 29, 12, 6, 1, 1 classes.
    expect([...Array(13).keys()].map((n) => counts.get(n))).toEqual([1, 1, 6, 12, 29, 38, 50, 38, 29, 12, 6, 1, 1]);
  });
  it('names every set of 3 to 9 notes', () => {
    for (let mask = 0; mask < 4096; mask++) {
      const pcs = [...Array(12).keys()].filter((i) => mask & (1 << i));
      if (pcs.length >= 1 && pcs.length <= 11) expect(forteName(pcs), pcs.join()).not.toBeNull();
    }
  });
  it('gives complementary classes the same number', () => {
    expect(forteName(complementSet([0, 1, 4]))).toBe('9-3');
    expect(forteName(complementSet([0, 1, 2, 3, 4]))).toBe('7-1');
  });
});

describe('twelve-tone rows', () => {
  const p0 = [0, 11, 3, 4, 8, 7, 9, 5, 6, 1, 2, 10];
  it('derives the inversion and retrograde', () => {
    expect(rowInversion(p0, 0)).toEqual([0, 1, 9, 8, 4, 5, 3, 7, 6, 11, 10, 2]);
    expect(rowRetrograde(p0)).toEqual([10, 2, 1, 6, 5, 9, 7, 8, 4, 3, 11, 0]);
  });
  it('builds a matrix with P0 on top and I0 down the side', () => {
    const m = rowMatrix(p0);
    expect(m[0]).toEqual(p0);
    expect(m.map((r) => r[0])).toEqual(rowInversion(p0, 0));
    for (const r of m) expect(isRow(r)).toBe(true);
  });
  it('rejects a list that is not a row', () => {
    expect(isRow([0, 1, 2])).toBe(false);
    expect(isRow([0, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])).toBe(false);
  });
});
