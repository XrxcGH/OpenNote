import { describe, expect, it } from 'vitest';
import {
  averageFlowStress,
  bend,
  blanking,
  chvorinov,
  drawing,
  extrusion,
  forging,
  layers,
  patternSize,
  riser,
  rolling,
  weldHeat,
} from './forming';

const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(String((r as unknown as { problem: string }).problem));
  return r as Extract<T, { ok: true }>;
};
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe('rolling', () => {
  it('R 250, 25 to 20 mm, w 300, Yf 250, mu 0.12', () => {
    const r = ok(rolling(250, 25, 20, 300, 250, 0.12, null));
    expect(r.contact).toBeCloseTo(Math.sqrt(250 * 5), 12);
    expect(rel(r.contact, 35.355)).toBeLessThan(1e-4);
    expect(rel(r.force, 2.6517e6)).toBeLessThan(1e-4);
    expect(r.maxDraft).toBeCloseTo(3.6, 12);
    expect(r.power).toBeNull();
  });
  it('power uses both rolls', () => {
    const r = ok(rolling(250, 25, 20, 300, 250, 0.12, 2));
    expect(r.power).toBeCloseTo(2 * Math.PI * 2 * r.force * r.contact, 3);
  });
  it('rejects a thickness gain, zero radius and negative friction', () => {
    expect(rolling(250, 20, 25, 300, 250, 0.12, null)).toEqual({ ok: false, problem: 'thicknessIncrease' });
    expect(rolling(0, 25, 20, 300, 250, 0.12, null)).toEqual({ ok: false, problem: 'radiusPositive' });
    expect(rolling(250, 25, 20, 300, 250, -1, null)).toEqual({ ok: false, problem: 'frictionNegative' });
  });
  it('no reduction means no force', () => {
    const r = ok(rolling(250, 25, 25, 300, 250, 0.1, null));
    expect(r.force).toBe(0);
  });
});

describe('flow stress, forging, extrusion, drawing', () => {
  it('average flow stress K e^n / (1 + n)', () => {
    expect(ok(averageFlowStress(500, 0.2, 0.5)).yf).toBeCloseTo((500 * 0.5 ** 0.2) / 1.2, 12);
    expect(averageFlowStress(500, 1.5, 0.5)).toEqual({ ok: false, problem: 'hardeningRange' });
  });
  it('forging force with friction', () => {
    const r = ok(forging(100, 50, 200, 0.2));
    expect(r.frictionFactor).toBeCloseTo(1.16, 12);
    expect(r.force).toBeCloseTo(1.16 * 200 * Math.PI * 2500, 6);
    expect(ok(forging(100, 50, 200, 0)).frictionFactor).toBe(1);
  });
  it('extrusion pressure by Johnson', () => {
    const r = ok(extrusion(5000, 1000, 300, 400, 80));
    expect(r.ratio).toBe(5);
    expect(r.extrusionStrain).toBeCloseTo(0.8 + 1.4 * Math.log(5), 12);
    expect(r.pressureIndirect).toBeCloseTo(300 * r.extrusionStrain, 9);
    expect(r.pressureDirect).toBeCloseTo(300 * (r.extrusionStrain + 10), 9);
    expect(extrusion(1000, 5000, 300, 400, 80)).toEqual({ ok: false, problem: 'areaIncrease' });
  });
  it('drawing stress', () => {
    const r = ok(drawing(100, 80, 250, 0.1, 6));
    const e = Math.log(1.25);
    expect(r.stress).toBeCloseTo(250 * (1 + 0.1 / Math.tan((6 * Math.PI) / 180)) * e, 9);
    expect(drawing(100, 100, 250, 0.1, 6)).toEqual({ ok: false, problem: 'areaNotReduced' });
    expect(drawing(100, 80, 250, 0.1, 60)).toEqual({ ok: false, problem: 'dieAngleRange' });
  });
});

describe('sheet metal', () => {
  it('bend 90 degrees, R 5, t 2, K 0.33 gives 8.8907', () => {
    const r = ok(bend(90, 5, 2, 0.33));
    expect(rel(r.allowance, 8.8907)).toBeLessThan(1e-4);
    expect(r.allowance).toBeCloseTo((Math.PI / 2) * 5.66, 12);
    expect(r.outsideSetback).toBeCloseTo(7, 12);
    expect(r.deduction).toBeCloseTo(14 - r.allowance, 12);
  });
  it('rejects a flat or reversed bend', () => {
    expect(bend(0, 5, 2, 0.33)).toEqual({ ok: false, problem: 'bendAngleRange' });
    expect(bend(90, 5, 2, 0.9)).toEqual({ ok: false, problem: 'kFactorRange' });
  });
  it('blanking a 50 mm circle in 2 mm, 400 MPa gives 87.965 kN', () => {
    const r = ok(blanking(Math.PI * 50, 2, 400));
    expect(rel(r.force, 87965)).toBeLessThan(1e-4);
    expect(blanking(0, 2, 400)).toEqual({ ok: false, problem: 'dimensionPositive' });
  });
});

describe('casting', () => {
  it('Chvorinov: B 2, 10 cm cube', () => {
    const r = ok(chvorinov(2, 1000, 600));
    expect(r.time).toBeCloseTo(2 * (1000 / 600) ** 2, 12);
    expect(r.time).toBeCloseTo(5.5556, 4);
  });
  it('a riser freezes after the casting', () => {
    const c = ok(chvorinov(2, 1000, 600));
    const r = ok(riser(1000, 600, 1.5));
    const t = ok(chvorinov(2, r.volume, Math.PI * r.diameter * r.height + (Math.PI * r.diameter ** 2) / 2));
    expect(t.time / c.time).toBeCloseTo(1.25, 9);
    expect(r.height).toBeCloseTo(1.5 * r.diameter, 12);
  });
  it('pattern size', () => {
    expect(ok(patternSize(100, 0.01)).pattern).toBeCloseTo(101, 12);
    expect(patternSize(100, 0.5)).toEqual({ ok: false, problem: 'shrinkageRange' });
  });
});

describe('joining and additive', () => {
  it('weld heat input V 20, I 200, 5 mm/s, 0.8 gives 640 J/mm', () => {
    expect(ok(weldHeat(20, 200, 5, 0.8)).heatInput).toBeCloseTo(640, 9);
    expect(weldHeat(20, 200, 0, 0.8)).toEqual({ ok: false, problem: 'travelPositive' });
    expect(weldHeat(20, 200, 5, 1.2)).toEqual({ ok: false, problem: 'efficiencyRange' });
  });
  it('layer 0.2 mm, 30 degrees gives a 0.17321 mm cusp', () => {
    const r = ok(layers(10, 0.2, 30));
    expect(rel(r.cusp, 0.17321)).toBeLessThan(1e-4);
    expect(r.layers).toBe(50);
  });
  it('rounds the layer count up and handles a vertical wall', () => {
    expect(ok(layers(10.01, 0.2, 90)).layers).toBe(51);
    expect(ok(layers(10, 0.2, 90)).cusp).toBeCloseTo(0, 12);
    expect(ok(layers(10, 0.2, 0)).cusp).toBeCloseTo(0.2, 12);
    expect(layers(10, 0, 30)).toEqual({ ok: false, problem: 'dimensionPositive' });
  });
});
