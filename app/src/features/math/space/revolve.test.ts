// Solids of revolution against textbook answers (Stewart, Calculus, sections 6.2 and 6.3).
import { describe, expect, it } from 'vitest';
import { integrate, nearFraction, piText, revolveVolume } from './revolve';
import type { RevolveSpec } from './source3d';

const about = (axis: 'x' | 'y', at = 0) => ({ kind: axis, at });
const spec = (outer: string, inner: string, from: number, to: number, axis: RevolveSpec['axis']): RevolveSpec => ({
  outer,
  inner,
  from,
  to,
  axis,
});

describe('solids of revolution', () => {
  it('finds the volume of a cone by disks', () => {
    // y = (3/4)x for 0 ≤ x ≤ 4 about the x-axis: a cone of radius 3 and height 4, V = πr²h/3 = 12π.
    const result = revolveVolume(spec('3x/4', '0', 0, 4, about('y')));
    if (!result.ok) throw new Error(result.error.message);
    expect(result.method).toBe('disk');
    expect(result.volume).toBeCloseTo(12 * Math.PI, 9);
    expect(result.exact).toBe('12π');
  });

  it('finds the volume of a sphere by disks', () => {
    // y = √(4 − x²) about the x-axis: a sphere of radius 2, V = (4/3)π·8 = 32π/3.
    const result = revolveVolume(spec('sqrt(4 - x^2)', '0', -2, 2, about('y')));
    if (!result.ok) throw new Error(result.error.message);
    expect(result.volume).toBeCloseTo((32 * Math.PI) / 3, 7);
    expect(result.exact).toBe('32π/3');
  });

  it('finds the volume of a paraboloid by disks', () => {
    // Stewart 6.2, Example 2: y = √x for 0 ≤ x ≤ 1 about the x-axis gives π/2; to x = 4 it gives 8π.
    const unit = revolveVolume(spec('sqrt(x)', '0', 0, 1, about('y')));
    const four = revolveVolume(spec('sqrt(x)', '0', 0, 4, about('y')));
    if (!unit.ok || !four.ok) throw new Error('read');
    expect(unit.volume).toBeCloseTo(Math.PI / 2, 9);
    expect(unit.exact).toBe('π/2');
    expect(four.exact).toBe('8π');
  });

  it('finds washers about the x-axis and about y = 2', () => {
    // Stewart 6.2, Example 4: between y = x and y = x² about the x-axis, V = 2π/15.
    const washer = revolveVolume(spec('x', 'x^2', 0, 1, about('y')));
    if (!washer.ok) throw new Error(washer.error.message);
    expect(washer.exact).toBe('2π/15');
    // Stewart 6.2, Example 5: the same region about y = 2, V = 8π/15.
    const shifted = revolveVolume(spec('x', 'x^2', 0, 1, about('y', 2)));
    if (!shifted.ok) throw new Error(shifted.error.message);
    expect(shifted.exact).toBe('8π/15');
    expect(shifted.steps.map((step) => step.id)).toEqual([
      'diskSetup',
      'radii',
      'diskFormula',
      'integral',
      'volume',
      'exact',
    ]);
  });

  it('finds shells about the y-axis and about x = 2', () => {
    // Stewart 6.3, Example 1: y = 2x² − x³ and y = 0 about the y-axis, V = 16π/5.
    const shell = revolveVolume(spec('2x^2 - x^3', '0', 0, 2, about('x')));
    if (!shell.ok) throw new Error(shell.error.message);
    expect(shell.method).toBe('shell');
    expect(shell.exact).toBe('16π/5');
    // Stewart 6.3, Example 4: y = x − x² and y = 0 about x = 2, V = π/2.
    const moved = revolveVolume(spec('x - x^2', '0', 0, 1, about('x', 2)));
    if (!moved.ok) throw new Error(moved.error.message);
    expect(moved.exact).toBe('π/2');
  });

  it('says when the other method was asked for, and reports bad curves', () => {
    const result = revolveVolume(spec('x', '0', 0, 1, about('x')), 'disk');
    expect(result.ok && result.steps[0].id).toBe('verticalDisk');
    expect(revolveVolume(spec('x +', '0', 0, 1, about('y'))).ok).toBe(false);
  });

  it('integrates and finds fractions', () => {
    expect(integrate(Math.sin, 0, Math.PI)).toBeCloseTo(2, 10);
    expect(nearFraction(0.4)).toEqual([2, 5]);
    expect(nearFraction(Math.SQRT2)).toBeNull();
    expect(piText([1, 2])).toBe('π/2');
    expect(piText([-1, 1])).toBe('−π');
  });
});
