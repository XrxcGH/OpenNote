// The growth z-score from age, sex, and measure. Expected values come from the CDC 2000 files themselves, not from
// this code: a measurement equal to a row's published P97 (or P95) column must give z = Φ⁻¹(0.97) = 1.880794 (or
// Φ⁻¹(0.95) = 1.644854), and between two rows L, M, and S are the rows' means at the midpoint.
import { beforeAll, describe, expect, it } from 'vitest';
import { LsError } from '../num/errors';
import { tool } from './tool';
import { growthLms, loadGrowth } from './growth';
import { makeReader } from '../ui/reader';

beforeAll(loadGrowth);

const calc = tool.calcs.find((c) => c.id === 'lms')!;
const solve = (text: Record<string, string>) => {
  const fields = typeof calc.fields === 'function' ? calc.fields((id) => text[id] ?? '') : calc.fields;
  return calc.solve(makeReader(fields, { text, unit: {} }));
};
const row = (result: ReturnType<typeof solve>, label: string) =>
  result.rows.find((r) => r.label === label)?.value as number;

describe('CDC 2000 growth tables', () => {
  it('give the published L, M, and S at a table age', () => {
    // statage.csv, Sex 2, Agemos 120.5: L 0.284748919, M 138.2111552, S 0.048704503.
    expect(growthLms('stature', 'female', 120.5)).toEqual({ l: 0.284748919, m: 138.2111552, s: 0.048704503 });
  });

  it('interpolate between rows', () => {
    // wtage.csv, Sex 1: M is 12.74154396 at 24.5 months and 12.88102276 at 25.5; at 25 months, their mean.
    expect(growthLms('weight', 'male', 25).m).toBeCloseTo(12.81128336, 8);
  });

  it('turn a published P97 stature into the 97th percentile', () => {
    // statage.csv, Sex 2, Agemos 120.5, P97 = 151.2919534 cm.
    const result = solve({
      source: 'tables',
      measure: 'stature',
      sex: 'female',
      age: String(120.5 / 12),
      x: '151.2919534',
    });
    expect(row(result, 'physiology.r.z')).toBeCloseTo(1.880794, 5);
    expect(row(result, 'physiology.r.percentile')).toBeCloseTo(97, 4);
  });

  it('turn a published P95 BMI into the 95th percentile', () => {
    // bmiagerev.csv, Sex 1, Agemos 120.5, P95 = 22.15409238 kg/m².
    const result = solve({ source: 'tables', measure: 'bmi', sex: 'male', age: String(120.5 / 12), x: '22.15409238' });
    expect(row(result, 'physiology.r.z')).toBeCloseTo(1.644854, 5);
  });

  it('refuse an age outside 2 to 20 years', () => {
    expect(() => solve({ source: 'tables', measure: 'weight', sex: 'male', age: '1', x: '10' })).toThrow(LsError);
    expect(() => growthLms('bmi', 'female', 241)).toThrow(LsError);
  });

  it('still take L, M, and S entered by hand', () => {
    const z = row(solve({ source: 'manual', x: '20', l: '-1', m: '16', s: '0.1' }), 'physiology.r.z');
    // ((20/16)^-1 − 1) / (−1 × 0.1) = (0.8 − 1) / −0.1 = 2.
    expect(z).toBeCloseTo(2, 9);
  });
});
