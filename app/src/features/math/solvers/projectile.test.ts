import { describe, expect, it } from 'vitest';
import { dragFactor, simulate, vacuumFlight } from './projectile';

describe('projectile', () => {
  it('matches the closed form with no drag within 1e-6', () => {
    for (const [speed, angle, height] of [
      [20, 45, 0],
      [35, 30, 12],
      [10, 75, 2],
      [15, -20, 40],
    ]) {
      const run = simulate({ speed, angle, height });
      const want = vacuumFlight(speed, angle, height);
      expect(Math.abs(run.range - want.range)).toBeLessThan(1e-6);
      expect(Math.abs(run.time - want.time)).toBeLessThan(1e-6);
      expect(Math.abs(run.maxHeight - want.maxHeight)).toBeLessThan(1e-6);
      expect(Math.abs(run.impactSpeed - want.impactSpeed)).toBeLessThan(1e-6);
    }
  });

  it('gives the textbook numbers for a 45° launch from the ground', () => {
    const flight = vacuumFlight(20, 45, 0, 9.81);
    expect(flight.range).toBeCloseTo(400 / 9.81, 10);
    expect(flight.maxHeight).toBeCloseTo(100 / 9.81, 10);
    expect(flight.impactAngle).toBeCloseTo(45, 10);
  });

  it('flies shorter and lower with drag, and lands slower', () => {
    const k = dragFactor(1.225, 0.47, Math.PI * 0.037 ** 2, 0.145);
    const run = simulate({ speed: 40, angle: 35, drag: k });
    expect(run.range).toBeLessThan(run.vacuum.range * 0.8);
    expect(run.maxHeight).toBeLessThan(run.vacuum.maxHeight);
    expect(run.impactSpeed).toBeLessThan(40);
    expect(run.impactAngle).toBeGreaterThan(35);
    expect(run.steps.at(-1)?.key).toBe('projectileDrag');
    expect(run.path.length).toBeGreaterThan(100);
  });

  it('refuses a launch into the ground', () => {
    expect(() => simulate({ speed: 10, angle: -10 })).toThrow('projectile-input');
  });

  it('flies straight up and back at 90°', () => {
    const run = simulate({ speed: 20, angle: 90 });
    expect(run.range).toBe(0);
    expect(run.maxHeight).toBeCloseTo(400 / (2 * 9.81), 6);
    expect(run.time).toBeCloseTo(40 / 9.81, 6);
  });
});
