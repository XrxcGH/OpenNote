import { describe, expect, it } from 'vitest';
import {
  GEAR_DEFAULTS,
  minPinionTeeth,
  minRackTeeth,
  PLANETARY_DEFAULTS,
  solveGearPair,
  solvePlanetary,
  solveTrain,
} from './engine';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const twenty = (20 * Math.PI) / 180;

describe('gears and gear trains', () => {
  it('m 2 mm, N1 20, N2 40, 20 deg full depth: centre distance, base radius, contact ratio', () => {
    const out = solveGearPair({ ...GEAR_DEFAULTS, module: 0.002, N1: 20, N2: 40, phi: twenty });
    if (!out.ok) throw new Error(out.error);
    const g = out.value;
    expect(rel(g.center * 1000, 60)).toBeLessThan(1e-4);
    expect(rel(g.rb1 * 1000, 18.794)).toBeLessThan(1e-4);
    expect(rel(g.contactRatio, 1.6352)).toBeLessThan(1e-4);
    // Independent: Z from the addendum circles 22 and 42 mm.
    const rb1 = 20 * Math.cos(twenty),
      rb2 = 40 * Math.cos(twenty);
    const Z = Math.sqrt(22 ** 2 - rb1 ** 2) + Math.sqrt(42 ** 2 - rb2 ** 2) - 60 * Math.sin(twenty);
    expect(g.contactRatio).toBeCloseTo(Z / (2 * Math.PI * Math.cos(twenty)), 12);
    expect(g.interference).toBe(false);
  });

  it('minimum pinion teeth meshing with an equal gear, 20 deg full depth', () => {
    expect(Math.abs(minPinionTeeth(twenty, 1) - 12.32)).toBeLessThan(1e-2);
    expect(minPinionTeeth(twenty, 1)).toBeCloseTo(12.3232, 3);
    const out = solveGearPair({ ...GEAR_DEFAULTS, N1: 12, N2: 12 });
    expect(out.ok && out.value.minTeethWhole).toBe(13);
    expect(out.ok && out.value.interference).toBe(true);
    expect(minRackTeeth(twenty)).toBeCloseTo(17.097, 3);
  });

  it('planetary: sun 30, ring 90, ring fixed, sun input, carrier output', () => {
    const out = solvePlanetary({ ...PLANETARY_DEFAULTS });
    if (!out.ok) throw new Error(out.error);
    expect(Math.abs(out.value.ratio - 4)).toBeLessThan(1e-9);
    expect(out.value.planet).toBe(30);
    expect(Math.abs(out.value.willisResidual)).toBeLessThan(1e-9);
    expect(out.value.spacingOk).toBe(true);
  });

  it('planetary inversions agree with the Willis formula', () => {
    for (const fixed of ['sun', 'ring', 'carrier'] as const) {
      for (const input of ['sun', 'ring', 'carrier'] as const) {
        const output = (['sun', 'ring', 'carrier'] as const).find((m) => m !== fixed && m !== input);
        if (fixed === input || !output) continue;
        const out = solvePlanetary({ ...PLANETARY_DEFAULTS, sun: 24, ring: 72, fixed, input, output, inputSpeed: 50 });
        if (!out.ok) throw new Error(out.error);
        const w = out.value.speeds;
        expect(w[fixed]).toBeCloseTo(0, 12);
        expect(w[input]).toBeCloseTo(50, 12);
        expect((w.ring - w.carrier) / (w.sun - w.carrier)).toBeCloseTo(-24 / 72, 12);
      }
    }
    // Carrier fixed: an ordinary train, ring turns backwards at Ns / Nr of the sun speed.
    const held = solvePlanetary({ ...PLANETARY_DEFAULTS, fixed: 'carrier', input: 'sun', output: 'ring' });
    expect(held.ok && held.value.ratio).toBeCloseTo(-3, 12);
  });

  it('simple and compound train values', () => {
    const simple = solveTrain([{ driver: 20, driven: 60, internal: false }], 30);
    expect(simple.ok && simple.value.value).toBeCloseTo(-1 / 3, 12);
    const compound = solveTrain(
      [
        { driver: 20, driven: 50, internal: false },
        { driver: 15, driven: 45, internal: false },
      ],
      100,
    );
    expect(compound.ok && compound.value.outputSpeed).toBeCloseTo((100 * 20 * 15) / (50 * 45), 12);
  });

  it('forces from power and speed', () => {
    const out = solveGearPair({ ...GEAR_DEFAULTS, power: 5000, speed: 100 });
    if (!out.ok) throw new Error(out.error);
    const f = out.value.forces!;
    expect(f.torque).toBeCloseTo(50, 12);
    expect(f.tangential).toBeCloseTo(50 / 0.02, 9);
    expect(f.radial).toBeCloseTo(2500 * Math.tan(twenty), 9);
  });

  it('rejects impossible input with a reason', () => {
    expect(solveGearPair({ ...GEAR_DEFAULTS, module: 0 })).toEqual({ ok: false, error: 'positiveModule' });
    expect(solveGearPair({ ...GEAR_DEFAULTS, N1: 20.5 })).toEqual({ ok: false, error: 'wholeTeeth' });
    expect(solveGearPair({ ...GEAR_DEFAULTS, phi: 0 })).toEqual({ ok: false, error: 'pressureAngle' });
    expect(solveGearPair({ ...GEAR_DEFAULTS, power: -1 })).toEqual({ ok: false, error: 'negativePower' });
    expect(solveGearPair({ ...GEAR_DEFAULTS, speed: 0 })).toEqual({ ok: false, error: 'positiveSpeed' });
    expect(solveGearPair({ ...GEAR_DEFAULTS, module: Number.NaN })).toEqual({ ok: false, error: 'notNumber' });
    expect(solvePlanetary({ ...PLANETARY_DEFAULTS, planet: 20 })).toMatchObject({ ok: false, error: 'planetFit' });
    expect(solvePlanetary({ ...PLANETARY_DEFAULTS, input: 'ring' })).toEqual({ ok: false, error: 'planetMembers' });
    expect(solveTrain([], 1)).toEqual({ ok: false, error: 'noStages' });
  });

  it('handles a huge gear', () => {
    const out = solveGearPair({ ...GEAR_DEFAULTS, N1: 20, N2: 2000, module: 0.01, power: 0 });
    expect(out.ok && out.value.center).toBeCloseTo(10.1, 9);
  });
});
