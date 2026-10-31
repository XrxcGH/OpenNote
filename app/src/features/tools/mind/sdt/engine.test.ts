// Signal detection against values worked from first principles and from closed forms.
import { describe, expect, it } from 'vitest';
import { normCdf } from '../kit/num';
import { dPrimeMafc, pcMafc, ratesFromCounts, ratingRoc, yesNo } from './engine';

const close = (got: number, want: number, tol: number) => expect(Math.abs(got - want)).toBeLessThanOrEqual(tol);

describe('yes-no sensitivity and bias', () => {
  it('gives d prime 1.68324 with no bias for H 0.8 and F 0.2', () => {
    const r = yesNo(0.8, 0.2);
    close(r.dPrime, 1.68324, 1e-5);
    close(r.c, 0, 1e-12);
    close(r.beta, 1, 1e-12);
  });

  it('gives d prime, c, beta, and A prime for H 0.9 and F 0.3', () => {
    const r = yesNo(0.9, 0.3);
    close(r.dPrime, 1.80595, 1e-5);
    close(r.c, -0.378576, 1e-6);
    close(r.beta, 0.504751, 1e-6);
    close(r.aPrime, 0.880952, 1e-6);
    close(r.lnBeta, r.dPrime * r.c, 1e-12);
  });

  it('mirrors A prime and B double prime when hits fall below false alarms', () => {
    const up = yesNo(0.9, 0.3);
    const down = yesNo(0.3, 0.9);
    close(up.aPrime + down.aPrime, 1, 1e-12);
    close(up.bDouble, -yesNo(0.7, 0.1).bDouble, 1e-12);
  });

  it('applies the log-linear correction to 20 of 20 hits and 0 of 20 false alarms', () => {
    const rates = ratesFromCounts(20, 0, 0, 20, 'loglinear');
    close(rates.H, 0.97619, 1e-5);
    close(rates.F, 0.0238095, 1e-7);
    close(yesNo(rates.H, rates.F).dPrime, 3.9615, 1e-4);
  });

  it('applies the 1/(2N) rule only to rates of 0 and 1', () => {
    const rates = ratesFromCounts(20, 0, 5, 15, 'half');
    close(rates.H, 1 - 1 / 40, 1e-15);
    close(rates.F, 0.25, 1e-15);
  });

  it('stops on rates of 0 or 1, rates out of range, and empty trials', () => {
    expect(() => yesNo(1, 0.2)).toThrow('extremeRate');
    expect(() => yesNo(1.2, 0.2)).toThrow('range');
    expect(() => ratesFromCounts(0, 0, 3, 4, 'none')).toThrow('noTrials');
    expect(() => ratesFromCounts(-1, 2, 3, 4, 'none')).toThrow('notNegative');
  });
});

describe('forced choice', () => {
  it('gives d prime 0.998863 for 76% correct in 2AFC', () => {
    close(dPrimeMafc(0.76, 2), 0.998863, 1e-6);
  });

  it('integrates to chance at d prime 0 and rises toward 1', () => {
    const values = [0, 0.5, 1.5, 3, 8].map((d) => pcMafc(d, 3));
    close(values[0], 1 / 3, 1e-10);
    expect(values.every((v, i) => i === 0 || v > values[i - 1])).toBe(true);
    close(values[4], 1, 1e-6);
    close(pcMafc(0, 4), 0.25, 1e-10);
    close(pcMafc(0, 8), 0.125, 1e-10);
    close(dPrimeMafc(normCdf(1 / Math.SQRT2), 2), 1, 1e-12);
  });

  it('round-trips d prime through proportion correct for 4 alternatives', () => {
    close(dPrimeMafc(pcMafc(1.3, 4), 4), 1.3, 1e-9);
  });

  it('stops on perfect performance and on fewer than 2 alternatives', () => {
    expect(() => dPrimeMafc(1, 2)).toThrow('perfect');
    expect(() => dPrimeMafc(0.7, 1)).toThrow('whole');
  });
});

describe('rating ROC', () => {
  it('recovers slope 0.8 and intercept 1.2 from an unequal-variance model', () => {
    // Signal mean 1.5 and SD 1.25 against noise N(0, 1): z(H) = 1.2 + 0.8 z(F) at every criterion.
    const criteria = [1.5, 1, 0.5, 0, -0.5];
    const H = [0, ...criteria.map((c) => 1 - normCdf((c - 1.5) / 1.25)), 1];
    const F = [0, ...criteria.map((c) => 1 - normCdf(c)), 1];
    const signal = H.slice(1).map((h, i) => (h - H[i]) * 1000);
    const noise = F.slice(1).map((f, i) => (f - F[i]) * 1000);
    const r = ratingRoc(signal, noise, 'none');
    close(r.slope, 0.8, 1e-9);
    close(r.intercept, 1.2, 1e-9);
    close(r.dA, 1.2 * Math.sqrt(2 / 1.64), 1e-9);
    close(r.Az, normCdf(r.dA / Math.SQRT2), 1e-12);
  });

  it('gives the area under straight lines through the points', () => {
    // One point at (0.25, 0.75): the area is 0.75.
    close(ratingRoc([3, 1], [1, 3], 'none').area, 0.75, 1e-12);
  });

  it('stops on lists of different lengths or with 1 category', () => {
    expect(() => ratingRoc([1, 2], [1, 2, 3], 'none')).toThrow('sameLength');
    expect(() => ratingRoc([1], [1], 'none')).toThrow('fewCategories');
  });
});
