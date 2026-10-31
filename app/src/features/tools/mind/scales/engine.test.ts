// Scales and psychometrics against values worked from first principles and by hand.
import { describe, expect, it } from 'vitest';
import { normCdf } from '../kit/num';
import { gradedInformation, gradedProbabilities, information, pCorrect } from './irt';
import { analyseItems, reverse, scoreScales, sus, transform } from './items';
import { kuderRichardson, lengthFor, reliability, spearmanBrown, splitHalf } from './reliability';

const close = (got: number, want: number, tol: number) => expect(Math.abs(got - want)).toBeLessThanOrEqual(tol);

const LIKERT = [
  [3, 4, 3, 5],
  [2, 2, 3, 2],
  [4, 5, 4, 4],
  [3, 3, 2, 3],
  [5, 4, 5, 5],
  [1, 2, 1, 2],
];
const BINARY = [
  [1, 1, 0, 1, 1],
  [1, 0, 0, 1, 0],
  [1, 1, 1, 1, 1],
  [0, 0, 0, 1, 0],
  [1, 1, 0, 0, 1],
  [1, 1, 1, 1, 0],
];

describe('reliability', () => {
  it("gives Cronbach's alpha 0.93992 for 6 respondents and 4 items", () => {
    const r = reliability(LIKERT);
    close(r.alpha, 0.93992, 1e-5);
    expect(r.low).toBeLessThan(r.alpha);
    expect(r.high).toBeGreaterThan(r.alpha);
    expect(r.high).toBeLessThanOrEqual(1);
  });

  it('gives KR-20 0.576923 with the population variance, and KR-21 by hand', () => {
    const r = kuderRichardson(BINARY);
    close(r.kr20, 0.576923, 1e-6);
    // KR-21: M = 19/6 and variance 65/36, so 5/4 (1 - M (5 - M) / (5 x 65/36)) = 0.446154.
    close(r.kr21, 0.446154, 1e-6);
  });

  it('applies the Spearman-Brown prophecy both ways', () => {
    close(spearmanBrown(0.6, 2), 0.75, 1e-12);
    close(spearmanBrown(0.7, 3), 0.875, 1e-12);
    close(lengthFor(0.7, 0.875), 3, 1e-12);
  });

  it('splits a test into odd and even halves', () => {
    const r = splitHalf(LIKERT, 'oddEven');
    close(r.corrected, (2 * r.r) / (1 + r.r), 1e-12);
  });

  it('stops on too few respondents, items that are not 0 or 1, and no variation', () => {
    expect(() =>
      reliability([
        [1, 2],
        [2, 3],
      ]),
    ).toThrow('fewRespondents');
    expect(() => kuderRichardson(LIKERT)).toThrow('binary');
    expect(() =>
      reliability([
        [1, 1],
        [1, 1],
        [1, 1],
      ]),
    ).toThrow('noVariation');
  });
});

describe('scoring and items', () => {
  it('reverses and prorates a subscale', () => {
    expect(reverse(2, 1, 5)).toBe(4);
    const scores = scoreScales([[4, 2, NaN, 2]], [{ name: 'all', items: [1, 2, 3, 4] }], {
      reversed: new Set([2]),
      low: 1,
      high: 5,
      method: 'sum',
      maxMissing: 1,
    });
    close(scores[0][0], ((4 + 4 + 2) / 3) * 4, 1e-12);
    const strict = scoreScales([[4, 2, NaN, 2]], [{ name: 'all', items: [1, 2, 3, 4] }], {
      reversed: new Set(),
      low: 1,
      high: 5,
      method: 'mean',
      maxMissing: 0,
    });
    expect(strict[0][0]).toBeNaN();
  });

  it('gives difficulty and discrimination with upper and lower groups, worked by hand', () => {
    const answers = ['ABC', 'ABC', 'ABD', 'ACC', 'ABD', 'ADD', 'ACD', 'BCD'].map((row) => row.split(''));
    const r = analyseItems(answers, ['A', 'B', 'C']);
    expect(r.groupSize).toBe(2);
    close(r.items[0].p, 0.875, 1e-12);
    close(r.items[0].d, 0.5, 1e-12);
    close(r.items[1].p, 0.5, 1e-12);
    close(r.items[1].d, 1, 1e-12);
    close(r.items[2].d, 1, 1e-12);
    expect(r.items[1].lower.C).toBe(2);
  });

  it('transforms a score of 115 on a scale with mean 100 and SD 15', () => {
    const r = transform(115, 100, 15, 0.91, 0.95);
    close(r.z, 1, 1e-12);
    close(r.t, 60, 1e-12);
    expect(r.stanine).toBe(7);
    close(r.percentile, 100 * normCdf(1), 1e-12);
    close(r.sem, 4.5, 1e-12);
    close(r.low, 115 - 1.959963984540054 * 4.5, 1e-9);
    close(r.trueScore, 113.65, 1e-9);
    close(r.see, 15 * Math.sqrt(0.91 * 0.09), 1e-12);
  });

  it('scores the System Usability Scale', () => {
    expect(sus(Array(10).fill(3))).toBe(50);
    expect(sus([5, 1, 5, 1, 5, 1, 5, 1, 5, 1])).toBe(100);
    expect(() => sus([3, 3])).toThrow('tenItems');
    expect(() => sus([6, 3, 3, 3, 3, 3, 3, 3, 3, 3])).toThrow('likert5');
  });
});

describe('item response curves', () => {
  it('gives the 2PL probability and information at theta 0', () => {
    const item = { a: 1.5, b: 0.5, c: 0 };
    close(pCorrect(0, item, 1), 0.320821, 1e-6);
    close(information(0, item, 1), 0.490264, 1e-6);
  });

  it('gives the 3PL probability with a 1.2, b 0, c 0.2, D 1.7 at theta 1', () => {
    close(pCorrect(1, { a: 1.2, b: 0, c: 0.2 }, 1.7), 0.907947, 1e-6);
  });

  it('reduces the graded response model with 1 threshold to the 2PL', () => {
    const graded = { a: 1.5, b: [0.5] };
    close(gradedInformation(0, graded, 1), 0.490264, 1e-6);
    const probs = gradedProbabilities(0.3, { a: 1.2, b: [-1, 0, 1.5] }, 1.7);
    close(
      probs.reduce((s, v) => s + v, 0),
      1,
      1e-12,
    );
    expect(probs.every((p) => p > 0)).toBe(true);
  });
});
