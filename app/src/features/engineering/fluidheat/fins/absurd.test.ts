// An absurd input must give a named problem, never NaN printed as an answer (fin q = NaN W for 1e-12 or 1e12).
import '../text';
import { readQuantity } from '../kit/units';
import { describe, expect, it } from 'vitest';
import { firstTexts, runTool } from '../kit/read';
import { finsSpec } from './spec';

const run = (texts: Record<string, string>) => runTool(finsSpec, { ...firstTexts(finsSpec), ...texts }, 'si');

describe('absurd inputs in the fins tool', () => {
  it('reports an input that makes the answer NaN as out of range', () => {
    // m L = sqrt(h P / (k A)) L overflows cosh to Infinity, and Infinity / Infinity is NaN.
    const result = run({ size: '1e-12 m' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error?.code).toBe('outOfRange');
  });

  it('still answers an ordinary fin', () => {
    expect(run({}).ok).toBe(true);
  });

  it('does not read a half-typed exponent as 2.5 times e', () => {
    // "2.5e mm" was 2.5 x 2.71828 = 6.79 mm; a half-typed exponent is a slip.
    expect(() => readQuantity('2.5e', 'length', 'si')).toThrow();
    expect(() => readQuantity('2.5e mm', 'length', 'si')).toThrow();
    expect(readQuantity('2.5e3 mm', 'length', 'si')).toBeCloseTo(2.5, 12);
  });
});
