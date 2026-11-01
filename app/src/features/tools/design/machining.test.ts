import './text';
import { describe, expect, it } from 'vitest';
import {
  drilling,
  economics,
  forces,
  merchantShearAngle,
  milling,
  shearAngleFromRatio,
  speedForLife,
  spindleSpeed,
  toolLife,
  turning,
} from './machining';

const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(String((r as unknown as { problem: string }).problem));
  return r as Extract<T, { ok: true }>;
};

describe('turning', () => {
  it('D 50, V 150, f 0.25, d 2, L 200', () => {
    const r = ok(turning({ d: 50, v: 150, f: 0.25, depth: 2, length: 200 }));
    expect(r.rpm).toBeCloseTo((1000 * 150) / (Math.PI * 50), 9);
    expect(r.rpm).toBeCloseTo(954.93, 2);
    expect(r.mrrSec).toBeCloseTo(1250, 9);
    expect(r.time).toBeCloseTo(200 / (0.25 * 954.9296585513721), 9);
    expect(Math.abs(r.time - 0.83776) / 0.83776).toBeLessThan(1e-5);
  });
  it('rejects impossible cuts', () => {
    expect(turning({ d: 50, v: 150, f: 0.25, depth: 25, length: 200 })).toEqual({ ok: false, problem: 'depthTooDeep' });
    expect(turning({ d: 0, v: 150, f: 0.25, depth: 2, length: 200 })).toEqual({
      ok: false,
      problem: 'diameterPositive',
    });
    expect(turning({ d: 50, v: -1, f: 0.25, depth: 2, length: 200 })).toEqual({ ok: false, problem: 'speedPositive' });
    expect(turning({ d: 50, v: 150, f: 0, depth: 2, length: 200 })).toEqual({ ok: false, problem: 'feedPositive' });
    expect(turning({ d: 50, v: NaN, f: 0.25, depth: 2, length: 200 })).toEqual({ ok: false, problem: 'notNumber' });
  });
  it('spindle speed scales inversely with diameter', () => {
    const a = ok(spindleSpeed(100, 10)).rpm;
    const b = ok(spindleSpeed(100, 20)).rpm;
    expect(a / b).toBeCloseTo(2, 12);
  });
});

describe('drilling and milling', () => {
  it('drilling adds the point allowance', () => {
    const r = ok(drilling({ d: 10, v: 30, f: 0.2, depth: 20, pointAngle: 118 }));
    const n = (1000 * 30) / (Math.PI * 10);
    const tip = 5 / Math.tan((59 * Math.PI) / 180);
    expect(r.time).toBeCloseTo((20 + tip) / (0.2 * n), 9);
    expect(r.mrrMin).toBeCloseTo((Math.PI * 100 * 0.2 * n) / 4, 6);
    expect(drilling({ d: 10, v: 30, f: 0.2, depth: 20, pointAngle: 180 })).toEqual({
      ok: false,
      problem: 'pointAngleRange',
    });
  });
  it('milling feed rate, MRR and approach', () => {
    const r = ok(milling({ d: 20, v: 60, fz: 0.1, teeth: 4, width: 20, depth: 3, length: 100, kind: 'slot' }));
    const n = (1000 * 60) / (Math.PI * 20);
    expect(r.feedRate).toBeCloseTo(0.4 * n, 9);
    expect(r.mrrMin).toBeCloseTo(20 * 3 * 0.4 * n, 6);
    expect(r.time).toBeCloseTo(110 / (0.4 * n), 9);
    const p = ok(milling({ d: 20, v: 60, fz: 0.1, teeth: 4, width: 5, depth: 3, length: 100, kind: 'peripheral' }));
    expect(p.time).toBeCloseTo((100 + Math.sqrt(5 * 15)) / (0.4 * n), 9);
    expect(milling({ d: 20, v: 60, fz: 0.1, teeth: 2.5, width: 5, depth: 3, length: 100, kind: 'slot' })).toEqual({
      ok: false,
      problem: 'teethPositive',
    });
  });
});

describe('Taylor tool life', () => {
  it('n 0.25, C 400, V 150 gives 50.568 min', () => {
    const r = ok(toolLife(0.25, 400, 150));
    expect(r.life).toBeCloseTo((400 / 150) ** 4, 9);
    expect(Math.abs(r.life - 50.568) / 50.568).toBeLessThan(1e-4);
  });
  it('round trips through speedForLife', () => {
    const t = ok(toolLife(0.3, 350, 120)).life;
    expect(ok(speedForLife(0.3, 350, t)).v).toBeCloseTo(120, 9);
  });
  it('rejects n outside (0, 1]', () => {
    expect(toolLife(0, 400, 150)).toEqual({ ok: false, problem: 'taylorN' });
    expect(toolLife(1.2, 400, 150)).toEqual({ ok: false, problem: 'taylorN' });
    expect(toolLife(0.01, 400, 1e-9)).toEqual({ ok: false, problem: 'tooLarge' });
  });
  it('economics with no tool change time still gives the least-cost answer', () => {
    // By hand: n 0.25, Tch 0, Ce 4, Co 1: T = (4 - 1)(0 + 4) = 12 min, V = 400 / 12^0.25 = 214.9 m/min.
    const r = ok(economics(0.25, 400, 0, 4, 1));
    expect(r.costLife).toBeCloseTo(12, 12);
    expect(r.costSpeed).toBeCloseTo(214.9, 1);
    expect(r.rateLife).toBeNull();
    expect(economics(0.25, 400, 0, 0, 1)).toEqual({ ok: false, problem: 'changeTimePositive' });
  });
  it('economics: n 0.25, Tch 2, Ce 4, Co 1', () => {
    const r = ok(economics(0.25, 400, 2, 4, 1));
    expect(r.costLife).toBeCloseTo(3 * 6, 12);
    expect(r.rateLife).toBeCloseTo(6, 12);
    expect(r.costSpeed).toBeCloseTo(400 / 18 ** 0.25, 12);
    expect(r.rateSpeed).toBeGreaterThan(r.costSpeed);
    expect(economics(1, 400, 2, 4, 1)).toEqual({ ok: false, problem: 'taylorNEconomics' });
    expect(economics(0.25, 400, 1, 4, 0)).toEqual({ ok: false, problem: 'ratePositive' });
  });
});

describe('Merchant circle', () => {
  it('rake 10, friction angle 35 gives 32.5 degrees', () => {
    expect(ok(merchantShearAngle(10, 35)).phi).toBeCloseTo(32.5, 12);
  });
  it('shear angle from the chip ratio matches the textbook identity', () => {
    // r = 0.5 with zero rake: tan phi = 0.5
    expect(ok(shearAngleFromRatio(0.5, 0)).phi).toBeCloseTo((Math.atan(0.5) * 180) / Math.PI, 12);
    expect(shearAngleFromRatio(0, 0)).toEqual({ ok: false, problem: 'ratioRange' });
  });
  it('rejects impossible angles', () => {
    expect(merchantShearAngle(10, 0)).toEqual({ ok: false, problem: 'frictionRange' });
    expect(merchantShearAngle(-80, 80)).toEqual({ ok: false, problem: 'shearAngleRange' });
  });
  it('forces satisfy the circle: Fs^2 + Fn^2 = F^2 + N^2 = R^2', () => {
    const r = ok(forces(1000, 400, 10, 30, 0.2, 3, 120));
    const R2 = 1000 ** 2 + 400 ** 2;
    expect(r.friction ** 2 + r.normal ** 2).toBeCloseTo(R2, 6);
    expect(r.shear ** 2 + r.shearNormal ** 2).toBeCloseTo(R2, 6);
    expect(r.power).toBeCloseTo(2000, 9);
    expect(r.specificEnergy).toBeCloseTo(1000 / 0.6, 9);
    expect(r.mu).toBeCloseTo(Math.tan((r.beta * Math.PI) / 180), 12);
    // independent: shear stress = Fs sin(phi) / (w t0)
    expect(r.shearStress).toBeCloseTo((r.shear * Math.sin(Math.PI / 6)) / 0.6, 9);
  });
  it('rejects zero force and bad speed', () => {
    expect(forces(0, 400, 10, 30, 0.2, 3, 120)).toEqual({ ok: false, problem: 'forcePositive' });
    expect(forces(1000, 400, 10, 30, 0.2, 3, 0)).toEqual({ ok: false, problem: 'speedPositive' });
  });
});
