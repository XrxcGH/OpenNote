// Biodiversity and field sampling against the planning pass's independent values (first principles and hand
// calculation), plus the documented errors.
import { describe, expect, it } from 'vitest';
import { LsError } from '../num/errors';
import {
  accumulation,
  ace,
  chao1,
  dispersion,
  dispersionResult,
  indices,
  petersen,
  pointQuarter,
  quadrats,
  rarefy,
  schnabel,
  similarity,
} from './engine';

describe('diversity indices', () => {
  it('match the abundances 10, 20, 30, 40', () => {
    const r = indices([10, 20, 30, 40]);
    expect(r.shannon).toBeCloseTo(1.27985, 5);
    expect(r.evenness).toBeCloseTo(0.92322, 5);
    expect(r.simpson).toBeCloseTo(0.3, 12);
    expect(r.hill2).toBeCloseTo(3.33333, 5);
    expect(r.simpsonUnbiased).toBeCloseTo(0.292929, 6);
    expect(r.bergerParker).toBeCloseTo(0.4, 12);
  });

  it('give Shannon in bits with base 2', () => {
    expect(indices([1, 1], '2').shannon).toBeCloseTo(1, 12);
  });

  it('ignore absent species and refuse an empty list', () => {
    expect(indices([0, 5, 5]).S).toBe(2);
    expect(() => indices([0, 0])).toThrow(LsError);
    expect(() => indices([1.5])).toThrow(LsError);
  });
});

describe('richness estimators', () => {
  it('give Chao1 = 14 with 10 species, 4 singletons and 2 doubletons', () => {
    expect(chao1([1, 1, 1, 1, 2, 2, 5, 6, 7, 8]).estimate).toBe(14);
  });

  it('use the bias-corrected Chao1 when there are no doubletons', () => {
    // S = 3, F1 = 2, N = 12: 3 + (11/12)(2)(1)/2 = 3.916667.
    expect(chao1([1, 1, 10]).estimate).toBeCloseTo(3 + 11 / 12, 12);
  });

  it('give ACE equal to S when no species is rare', () => {
    expect(ace([20, 30]).estimate).toBe(2);
  });

  it('say ACE is undefined when every rare species is a singleton', () => {
    expect(() => ace([1, 1, 20])).toThrow(LsError);
  });
});

describe('rarefaction', () => {
  it('gives E(S10) = 3.54713 for 10, 20, 30, 40', () => {
    expect(rarefy([10, 20, 30, 40], 10)).toBeCloseTo(3.54713, 5);
  });

  it('reaches S at the full sample and refuses a larger one', () => {
    expect(rarefy([10, 20, 30, 40], 100)).toBeCloseTo(4, 12);
    expect(() => rarefy([10, 20], 31)).toThrow(LsError);
  });
});

describe('species accumulation', () => {
  it('repeats for a seed and ends at the total richness', () => {
    const table = [
      [1, 0, 0],
      [0, 2, 0],
      [3, 0, 1],
    ];
    const a = accumulation(table, 50, 4);
    expect(a).toEqual(accumulation(table, 50, 4));
    expect(a[2].mean).toBe(3);
  });
});

describe('similarity', () => {
  it('matches Jaccard 0.5, Sørensen 0.66667 and Bray-Curtis 0.33333', () => {
    const x = [1, 1, 1, 1, 1, 1, 1, 1, 0, 0];
    const y = [1, 1, 1, 1, 1, 0, 0, 0, 1, 1];
    expect(similarity(x, y, 'jaccard')).toBeCloseTo(0.5, 12);
    expect(similarity(x, y, 'sorensen')).toBeCloseTo(0.666667, 5);
    expect(similarity([10, 0, 5], [5, 5, 5], 'brayCurtis')).toBeCloseTo(0.333333, 5);
  });

  it('gives Morisita-Horn 1 for identical sites', () => {
    expect(similarity([3, 4, 5], [3, 4, 5], 'morisitaHorn')).toBeCloseTo(1, 12);
  });
});

describe('quadrats and point quarters', () => {
  it('add relative values to 300', () => {
    const out = quadrats(
      [
        [12, 6, 180],
        [30, 9, 120],
      ],
      10,
      1,
    );
    expect(out[0].density).toBeCloseTo(1.2, 12);
    expect(out[0].importance + out[1].importance).toBeCloseTo(300, 9);
  });

  it('give density 1/d̄² and refuse a point without 4 distances', () => {
    expect(pointQuarter([[1, 1, 2, 2]]).density).toBeCloseTo(1 / 2.25, 12);
    expect(() => pointQuarter([[1, 2, 3]])).toThrow(LsError);
  });
});

describe('dispersion', () => {
  it('matches VMR 1.71429 and chi-square 12 on 7 df with p = 0.1006', () => {
    const r = dispersion([0, 2, 1, 4, 3, 0, 5, 1]);
    expect(r.vmr).toBeCloseTo(1.71429, 5);
    expect(r.chi2).toBeCloseTo(12, 12);
    expect(r.df).toBe(7);
    expect(r.upper).toBeCloseTo(0.1006, 4);
    expect(r.morisita).toBeCloseTo(4 / 3, 12);
    expect(dispersionResult([0, 2, 1, 4, 3, 0, 5, 1]).notes?.[0].key).toBe('diversity.n.random');
  });

  it('refuses all-zero counts', () => {
    expect(() => dispersion([0, 0, 0])).toThrow(LsError);
  });
});

describe('mark-recapture', () => {
  it('gives Lincoln-Petersen 200 and Chapman 189.091', () => {
    const r = petersen(50, 40, 10);
    expect(r.lincoln).toBe(200);
    expect(r.chapman).toBeCloseTo(189.091, 3);
  });

  it('refuses more recaptures than captures', () => {
    expect(() => petersen(10, 5, 6)).toThrow(LsError);
  });

  it('gives Schnabel and Schumacher-Eschmeyer estimates by hand', () => {
    // M = 0, 10, 23, 31, 42; Σ C M = 150 + 276 + 558 + 588 = 1572; Σ R = 19; N = 1572/20 = 78.6.
    // Σ C M² = 1500 + 6348 + 17298 + 24696 = 49842; Σ R M = 20 + 92 + 217 + 252 = 581; N = 85.787.
    const r = schnabel([
      [10, 0],
      [15, 2],
      [12, 4],
      [18, 7],
      [14, 6],
    ]);
    expect(r.N).toBeCloseTo(78.6, 9);
    expect(r.NSE).toBeCloseTo(49842 / 581, 9);
    expect(r.low).toBeLessThan(r.N);
    expect(r.high).toBeGreaterThan(r.N);
  });

  it('says when nothing was recaptured', () => {
    expect(() =>
      schnabel([
        [10, 0],
        [10, 0],
      ]),
    ).toThrow(LsError);
  });
});
