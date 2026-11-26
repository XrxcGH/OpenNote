import { describe, expect, it } from 'vitest';
import { regionLimits, solveIntegral, type CoordinateSystem, type RegionKind } from './multiple';

const close = (a: number, b: number, tol = 1e-8) =>
  expect(Math.abs(a - b)).toBeLessThan(tol * Math.max(1, Math.abs(b)));

function region(kind: RegionKind, system: CoordinateSystem, p: Record<string, string>, integrand = '1') {
  return solveIntegral({ integrand, system, limits: regionLimits(kind, system, p)! });
}

describe('double and triple integrals', () => {
  it('works a type I region by hand', () => {
    const result = solveIntegral({
      integrand: 'x*y',
      system: 'rectangular',
      limits: [
        { variable: 'y', lower: '0', upper: 'x' },
        { variable: 'x', lower: '0', upper: '1' },
      ],
    });
    expect(result.symbolic).toBe(true);
    expect(result.valueText).toBe('1/8');
    expect(result.steps.map((s) => s.key)).toContain('integralInner');
    expect(result.outline?.length).toBeGreaterThan(10);
  });

  it('finds the area of a disk in polar and rectangular coordinates', () => {
    const polar = region('disk', 'polar', { R: '2' });
    expect(polar.symbolic).toBe(true);
    expect(polar.valueText).toBe('4π');
    const rect = region('disk', 'rectangular', { R: '2' });
    close(rect.value, 4 * Math.PI, 1e-7);
  });

  it('finds the volume of a ball in three systems', () => {
    const want = (4 / 3) * Math.PI * 27;
    const spherical = region('ball', 'spherical', { R: '3' });
    expect(spherical.symbolic).toBe(true);
    expect(spherical.valueText).toBe('36π');
    close(region('ball', 'cylindrical', { R: '3' }).value, want, 1e-6);
    close(region('ball', 'rectangular', { R: '3' }).value, want, 1e-5);
  });

  it('finds the volumes of a cylinder, a cone, and a box', () => {
    expect(region('cylinder', 'cylindrical', { R: '2', h: '5' }).valueText).toBe('20π');
    close(region('cone', 'cylindrical', { R: '1', h: '3' }).value, Math.PI);
    close(region('cone', 'spherical', { R: '1', h: '3' }).value, Math.PI, 1e-7);
    expect(region('box', 'rectangular', { a: '0', b: '1', c: '0', d: '2', e: '0', f: '3' }).valueText).toBe('6');
  });

  it('turns x and y into polar coordinates with the Jacobian', () => {
    // The volume under z = 4 - x^2 - y^2 over the disk r <= 2 is 8π.
    const result = region('disk', 'polar', { R: '2' }, '4 - x^2 - y^2');
    expect(result.steps[1].key).toBe('integralChange');
    expect(result.valueText).toBe('8π');
    expect(result.symbolic).toBe(true);
  });

  it('finds the tetrahedron volume and a moment of a ball', () => {
    const tetra = solveIntegral({
      integrand: '1',
      system: 'rectangular',
      limits: [
        { variable: 'z', lower: '0', upper: '1 - x - y' },
        { variable: 'y', lower: '0', upper: '1 - x' },
        { variable: 'x', lower: '0', upper: '1' },
      ],
    });
    expect(tetra.valueText).toBe('1/6');
    expect(tetra.symbolic).toBe(true);
    // ∭ z^2 over the unit ball is 4π/15.
    expect(region('ball', 'spherical', { R: '1' }, 'z^2').valueText).toBe('4π/15');
  });

  it('falls back to a number when no rule fits', () => {
    const result = solveIntegral({
      integrand: 'exp(x^2)',
      system: 'rectangular',
      limits: [
        { variable: 'x', lower: '0', upper: '1' },
        { variable: 'y', lower: '0', upper: '1' },
      ],
    });
    expect(result.symbolic).toBe(false);
    close(result.value, 1.462651745907182, 1e-9);
    expect(result.steps.some((s) => s.key === 'integralNoRule')).toBe(true);
  });

  it('refuses limits out of order', () => {
    expect(() =>
      solveIntegral({
        integrand: '1',
        system: 'rectangular',
        limits: [
          { variable: 'x', lower: '0', upper: '1' },
          { variable: 'y', lower: '0', upper: 'x' },
        ],
      }),
    ).toThrow('limits-order');
  });
});

describe('integrals that have no value, and backward limits', () => {
  const one = (integrand: string, lower: string, upper: string, variable = 'x') =>
    solveIntegral({ integrand, system: 'rectangular', limits: [{ variable, lower, upper }] });

  it('names a divergent integral at an endpoint instead of printing a number', () => {
    // The integral of 1/x from 0 to 1 does not converge (Stewart 7.8 style).
    expect(() => one('1/x', '0', '1')).toThrow('integral-diverges');
    expect(() => one('1/x', '1', '0')).toThrow('integral-diverges');
    expect(() => one('1/(1 - x)^2', '0', '1')).toThrow('integral-diverges');
    expect(() => one('1/x^2', '0', '2')).toThrow('integral-diverges');
  });

  it('names a pole inside the limits', () => {
    expect(() => one('1/x', '-1', '1')).toThrow('integral-undefined');
    expect(() => one('1/(x - 1)', '0', '2')).toThrow('integral-undefined');
    expect(() => one('tan(x)', '0', 'pi')).toThrow('integral-undefined');
  });

  it('names the diverging variable of a double integral', () => {
    expect(() =>
      solveIntegral({
        integrand: '1/x',
        system: 'rectangular',
        limits: [
          { variable: 'y', lower: '0', upper: '1' },
          { variable: 'x', lower: '0', upper: '1' },
        ],
      }),
    ).toThrow('integral-diverges');
  });

  it('still finds integrable singularities and removable points', () => {
    // Stewart 7.8: the integral of 1/sqrt(x) from 0 to 1 is 2, and of ln(x) from 0 to 1 is -1.
    close(one('1/sqrt(x)', '0', '1').value, 2, 1e-9);
    close(one('ln(x)', '0', '1').value, -1, 1e-9);
    close(one('1/sqrt(1 - x^2)', '-1', '1').value, Math.PI, 1e-6);
    // sin(x)/x has a removable point in the middle of the limits; Si(1) = 0.946083070367183, doubled.
    close(one('sin(x)/x', '-1', '1').value, 2 * 0.946083070367183, 1e-9);
  });

  it('notes backward limits and keeps the sign', () => {
    const forward = one('3*x^2', '0', '2');
    const backward = one('3*x^2', '2', '0');
    expect(forward.value).toBeCloseTo(8, 9);
    expect(backward.value).toBeCloseTo(-8, 9);
    expect(forward.steps.map((s) => s.key)).not.toContain('integralReversed');
    const note = backward.steps.find((s) => s.key === 'integralReversed');
    expect(note?.vars).toEqual({ variable: 'x', lower: '2', upper: '0' });
  });
});
