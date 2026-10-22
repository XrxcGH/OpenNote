import { describe, expect, it } from 'vitest';
import { checkUnits, dimsText, unitDims } from './dimensions';
import { propagate, roundedPair } from './uncertainty';

describe('error propagation', () => {
  it('adds absolute uncertainties in quadrature for a sum', () => {
    const result = propagate('x + y', [
      { name: 'x', value: 10, uncertainty: 0.3 },
      { name: 'y', value: 5, uncertainty: 0.4 },
    ]);
    expect(result.value).toBe(15);
    expect(result.uncertainty).toBeCloseTo(0.5, 14);
    expect(result.text).toBe('15.00 ± 0.50');
    expect(result.contributions.map((c) => c.share)).toEqual([expect.closeTo(0.36, 12), expect.closeTo(0.64, 12)]);
  });

  it('adds relative uncertainties in quadrature for a product and a quotient', () => {
    const product = propagate('x*y', [
      { name: 'x', value: 2, uncertainty: 0.02 },
      { name: 'y', value: 3, uncertainty: 0.06 },
    ]);
    expect(product.relative).toBeCloseTo(Math.hypot(0.01, 0.02), 14);
    const quotient = propagate('m/V', [
      { name: 'm', value: 50, uncertainty: 0.5 },
      { name: 'V', value: 20, uncertainty: 0.4 },
    ]);
    expect(quotient.relative).toBeCloseTo(Math.hypot(0.01, 0.02), 14);
  });

  it('works a pendulum measurement of g', () => {
    // g = 4π²L/T², L = 1.000 ± 0.005 m, T = 2.007 ± 0.010 s
    const result = propagate('4*pi^2*L/T^2', [
      { name: 'L', value: 1, uncertainty: 0.005 },
      { name: 'T', value: 2.007, uncertainty: 0.01 },
    ]);
    expect(result.value).toBeCloseTo(9.8007, 3);
    expect(result.relative).toBeCloseTo(Math.hypot(0.005, (2 * 0.01) / 2.007), 12);
    expect(result.steps.filter((s) => s.key === 'errorPartial')).toHaveLength(2);
    expect(result.text).toBe('9.80 ± 0.11');
  });

  it('rounds the way a lab report does', () => {
    expect(roundedPair(123.456, 1.234)).toBe('123.5 ± 1.2');
    expect(roundedPair(0.012341, 0.00067)).toBe('0.01234 ± 0.00067');
    expect(roundedPair(6.022e23, 3e20)).toBe('(6.0220 ± 0.0030)×10^23');
  });
});

describe('unit consistency', () => {
  it('reads units into base dimensions', () => {
    expect(dimsText(unitDims('N'))).toBe('m·kg·s⁻²');
    expect(dimsText(unitDims('kg*m/s^2'))).toBe('m·kg·s⁻²');
    expect(dimsText(unitDims('J/(kg*K)'.replace(/[()]/g, '').replace('kg*K', 'kg/K')))).not.toBe('');
    expect(dimsText(unitDims('m/s²'))).toBe('m·s⁻²');
    expect(dimsText(unitDims('V·A'))).toBe(dimsText(unitDims('W')));
    expect(() => unitDims('furlongz')).toThrow('unit-unknown');
  });

  it('passes consistent equations', () => {
    expect(checkUnits('F = m*a', { F: 'N', m: 'kg', a: 'm/s^2' }).ok).toBe(true);
    expect(checkUnits('E = m*c^2', { E: 'J', m: 'kg', c: 'm/s' }).ok).toBe(true);
    expect(checkUnits('x = x0 + v*t + a*t^2/2', { x: 'm', x0: 'm', v: 'm/s', t: 's', a: 'm/s^2' }).ok).toBe(true);
    expect(checkUnits('P = V*I', { P: 'W', V: 'V', I: 'A' }).ok).toBe(true);
    expect(checkUnits('T = 2*pi*sqrt(L/g)', { T: 's', L: 'm', g: 'm/s^2' }).ok).toBe(true);
  });

  it('flags inconsistent equations and says where', () => {
    const wrong = checkUnits('v = a*t^2', { v: 'm/s', a: 'm/s^2', t: 's' });
    expect(wrong.ok).toBe(false);
    expect(wrong.problems[0]).toMatchObject({ code: 'sides', left: 'm·s⁻¹', right: 'm' });
    const sum = checkUnits('d = v + t', { d: 'm', v: 'm/s', t: 's' });
    expect(sum.problems[0]).toMatchObject({ code: 'add', start: 4, end: 9 });
    const trig = checkUnits('y = sin(x)', { y: 'm', x: 'm' });
    expect(trig.problems.map((p) => p.code)).toEqual(['argument', 'sides']);
    expect(checkUnits('y = 2^t', { y: '1', t: 's' }).problems[0].code).toBe('exponent');
    expect(checkUnits('y = q*z', { y: 'm' }).problems.filter((p) => p.code === 'noUnit')).toHaveLength(2);
  });
});
