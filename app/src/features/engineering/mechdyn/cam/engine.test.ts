import { describe, expect, it } from 'vitest';
import { CAM_DEFAULTS, camMotion, pressureAngleAt, solveCam, type CamInput, type CamLaw } from './engine';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const withLaw = (law: CamLaw): CamInput => ({
  ...CAM_DEFAULTS,
  segments: CAM_DEFAULTS.segments.map((s) => ({ ...s, law })),
});
const ok = <T>(out: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!out.ok) throw new Error(out.error);
  return out.value;
};

describe('cam designer', () => {
  it('rise 25 mm over 90 deg: peak velocity and acceleration per radian', () => {
    const cyc = ok(solveCam(withLaw('cycloidal')));
    expect(rel(cyc.peaks.v * 1000, 31.831)).toBeLessThan(1e-5);
    expect(rel(cyc.peaks.a * 1000, 63.662)).toBeLessThan(1e-5);
    const shm = ok(solveCam(withLaw('harmonic')));
    expect(rel(shm.peaks.v * 1000, 25)).toBeLessThan(1e-5);
    expect(rel(shm.peaks.a * 1000, 50)).toBeLessThan(1e-5);
    const p345 = ok(solveCam(withLaw('poly345')));
    // The stated 29.842 is rounded to three decimals (exact 29.8415), so it is held to half its last digit; the
    // closed form below holds it to 1e-9.
    expect(Math.abs(p345.peaks.v * 1000 - 29.842)).toBeLessThan(5e-4);
    // Independent closed forms: 2h/beta, 2 pi h/beta^2, pi h/(2 beta), 15h/(8 beta).
    const h = 25,
      b = Math.PI / 2;
    expect(cyc.peaks.v * 1000).toBeCloseTo((2 * h) / b, 9);
    expect(cyc.peaks.a * 1000).toBeCloseTo((2 * Math.PI * h) / b ** 2, 9);
    expect(p345.peaks.v * 1000).toBeCloseTo((15 * h) / (8 * b), 9);
    const p4567 = ok(solveCam(withLaw('poly4567')));
    expect(p4567.peaks.v * 1000).toBeCloseTo((35 * h) / (16 * b), 9);
  });

  it('cycloidal at mid-rise, radial roller, prime circle 40 mm, no offset', () => {
    const input = { ...CAM_DEFAULTS, baseRadius: 0.03, rollerRadius: 0.01, offset: 0 };
    const phi = (pressureAngleAt(input, Math.PI / 4) * 180) / Math.PI;
    expect(Math.abs(phi - 31.229)).toBeLessThan(1e-3);
    // Independent: atan((2h/beta) / (Rp + h/2)).
    expect(phi).toBeCloseTo((Math.atan(31.830988618 / 52.5) * 180) / Math.PI, 6);
    const r = ok(solveCam(input));
    expect(Math.abs(r.pressure.max)).toBeGreaterThanOrEqual((31.229 * Math.PI) / 180 - 1e-6);
  });

  it('motion is continuous across segments and returns to zero', () => {
    for (const th of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2, 2 * Math.PI - 1e-12]) {
      const a = camMotion(CAM_DEFAULTS.segments, th - 1e-9),
        b = camMotion(CAM_DEFAULTS.segments, th + 1e-9);
      expect(Math.abs(a.s - b.s)).toBeLessThan(1e-9);
    }
    expect(camMotion(CAM_DEFAULTS.segments, Math.PI).s).toBeCloseTo(0.025, 12);
  });

  it('a pure dwell is a circle: radius of curvature equals the base circle', () => {
    const circle: CamInput = {
      ...CAM_DEFAULTS,
      segments: [{ kind: 'dwell', beta: 2 * Math.PI, lift: 0, law: 'cycloidal' }],
    };
    expect(ok(solveCam(circle)).curvature.min).toBeCloseTo(0.03, 9);
    expect(ok(solveCam({ ...circle, follower: 'flat' })).curvature.min).toBeCloseTo(0.03, 9);
    const roller = ok(solveCam(CAM_DEFAULTS));
    // The cam surface sits one roller radius inside the pitch curve.
    const surf = roller.profile.series[0].points,
      pitch = roller.profile.series[1].points;
    for (let i = 0; i < pitch.length; i += 37)
      expect(Math.hypot(surf[i][0] - pitch[i][0], surf[i][1] - pitch[i][1])).toBeCloseTo(0.01, 9);
  });

  it('flags undercutting on a small cam with a sharp rise', () => {
    const sharp: CamInput = {
      ...CAM_DEFAULTS,
      follower: 'flat',
      baseRadius: 0.005,
      segments: [
        { kind: 'rise', beta: Math.PI / 6, lift: 0.03, law: 'harmonic' },
        { kind: 'return', beta: Math.PI / 6, lift: 0.03, law: 'harmonic' },
        { kind: 'dwell', beta: (5 * Math.PI) / 3, lift: 0, law: 'harmonic' },
      ],
    };
    expect(ok(solveCam(sharp)).curvature.undercut).toBe(true);
  });

  it('rejects impossible programs with a reason', () => {
    const segs = CAM_DEFAULTS.segments;
    expect(solveCam({ ...CAM_DEFAULTS, segments: segs.slice(0, 3) })).toMatchObject({ ok: false, error: 'camCycle' });
    expect(solveCam({ ...CAM_DEFAULTS, segments: [segs[0], segs[1], { ...segs[2], lift: 0.02 }, segs[3]] })).toEqual({
      ok: false,
      error: 'camReturn',
    });
    expect(solveCam({ ...CAM_DEFAULTS, offset: 0.05 })).toEqual({ ok: false, error: 'camOffset' });
    expect(solveCam({ ...CAM_DEFAULTS, baseRadius: 0 })).toEqual({ ok: false, error: 'positiveRadius' });
    expect(solveCam({ ...CAM_DEFAULTS, segments: [] })).toEqual({ ok: false, error: 'camNoSegments' });
    expect(solveCam({ ...CAM_DEFAULTS, segments: [{ ...segs[0], lift: -1 }, ...segs.slice(1)] })).toEqual({
      ok: false,
      error: 'camLift',
    });
    expect(solveCam({ ...CAM_DEFAULTS, segments: [{ ...segs[2] }, segs[1], { ...segs[0] }, segs[3]] })).toEqual({
      ok: false,
      error: 'camBelowBase',
    });
  });
});
