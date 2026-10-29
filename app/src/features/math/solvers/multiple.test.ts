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
