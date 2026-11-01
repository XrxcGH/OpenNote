// Compensator design against the plan's cases and independent checks: the lead's phase at ωm from arctangents, the
// angle and magnitude conditions at the target pole, closed-loop poles from the characteristic polynomial, and the
// same loop measured by the frequency and systems tools.
import '../text';
import { describe, expect, it } from 'vitest';
import { ControlError } from '../lib/errors';
import { padd, pmul } from '../lib/poly';
import { cabs, cx, evalTF, feedback, readTF, rootsOf, series } from '../lib/tf';
import { grid, makeLoop, margins } from '../frequency/engine';
import { stepSpecs } from '../systems/engine';
import {
  designLag,
  designLead,
  designLeadLag,
  designLocusLead,
  leadRatio,
  pidTF,
  simc,
  ultimate,
  zieglerNichols,
} from './engine';

const DEG = 180 / Math.PI;

describe('validation cases', () => {
  it('Ziegler-Nichols from Ku = 48, ωu = 2.8284: Pu = 2.2214 s, Kp 28.8, Ti 1.1107 s, Td 0.27768 s', () => {
    const z = zieglerNichols(48, 2.8284);
    expect(Math.abs(z.pu / 2.2214 - 1)).toBeLessThan(1e-4);
    expect(z.pid.kp).toBeCloseTo(28.8, 12);
    expect(Math.abs(z.pid.ti / 1.1107 - 1)).toBeLessThan(1e-4);
    expect(Math.abs(z.pid.td / 0.27768 - 1)).toBeLessThan(1e-4);
  });

  it('a 40° lead needs α = (1 + sin 40°)/(1 − sin 40°) = 4.5989', () => {
    expect(leadRatio(40)).toBeCloseTo(4.5989, 4);
    // Independent: the peak phase of (1 + αs)/(1 + s) is asin((α − 1)/(α + 1)).
    expect(Math.asin((leadRatio(40) - 1) / (leadRatio(40) + 1)) * DEG).toBeCloseTo(40, 10);
  });

  it('the check after a design matches the frequency and systems tools on the same loop', () => {
    const g = readTF('4/(s (s + 2))');
    const d = designLead(g, 50, 20);
    const loop = series(d.c, g);
    const l = makeLoop(loop);
    const m = margins(l, grid(l));
    expect(d.after.margins.pm).toBeCloseTo(m.pm, 6);
    expect(d.after.margins.gm === m.gm || Math.abs(d.after.margins.gm - m.gm) < 1e-6).toBe(true);
    const s = stepSpecs(feedback(loop));
    expect(d.after.specs?.overshoot).toBeCloseTo(s.overshoot, 6);
    expect(d.after.specs?.settling).toBeCloseTo(s.settling, 6);
  });
});

describe('frequency designs', () => {
  it('lead on 4/(s(s + 2)) for Kv = 20 and PM 50°: K = 10, the lead adds φ at ωm, and PM is met', () => {
    const g = readTF('4/(s (s + 2))');
    const d = designLead(g, 50, 20);
    expect(d.values.k).toBeCloseTo(10, 12);
    const { z, p, wm, phi } = d.values;
    expect(Math.atan(wm / z) * DEG - Math.atan(wm / p) * DEG).toBeCloseTo(phi, 9);
    expect(d.after.margins.pm).toBeGreaterThan(49);
    expect(d.after.margins.wgc).toBeCloseTo(wm, 6);
    // Kv is kept: lim s·C(s)G(s) = K·2 = 20.
    expect(cabs(evalTF(series(d.c, g), cx(0, 1e-9))) * 1e-9).toBeCloseTo(20, 6);
  });

  it('lag on 1/(s(s + 1)(0.5s + 1)) for Kv = 5 and PM 40°', () => {
    const g = readTF('1/(s (s + 1) (0.5 s + 1))');
    const d = designLag(g, 40, 5);
    expect(d.before.margins.pm).toBeLessThan(0);
    expect(d.values.p).toBeLessThan(d.values.z);
    expect(d.after.margins.pm).toBeGreaterThan(38);
    expect(d.after.margins.pm).toBeLessThan(46);
  });
});

describe('root locus lead', () => {
  it('puts the closed-loop poles at s_d for ζ = 0.5, tₛ = 2 s on 1/(s(s + 2))', () => {
    const g = readTF('1/(s (s + 2))');
    const d = designLocusLead(g, 0.5, 2);
    const sd = cx(d.values.sdRe, d.values.sdIm);
    expect(d.values.wn).toBeCloseTo(4, 12);
    // Independent: s_d is a root of the closed loop's characteristic polynomial D_c D_g + N_c N_g.
    const char = padd(pmul(d.c.den, g.den), pmul(d.c.num, g.num));
    const nearest = Math.min(...rootsOf(char).map((r) => Math.hypot(r.re - sd.re, r.im - sd.im)));
    expect(nearest).toBeLessThan(1e-8);
  });
});

describe('PID tuning', () => {
  it('finds Ku = 48 and ωu = √8 for 1/(s(s + 2)(s + 4))', () => {
    const u = ultimate(readTF('1/(s (s + 2) (s + 4))'));
    expect(u.ku).toBeCloseTo(48, 8);
    expect(u.wu).toBeCloseTo(Math.sqrt(8), 9);
  });

  it('SIMC for K = 2, τ = 10, θ = 1 with τc = θ: Kc = 2.5, Ti = 8', () => {
    const r = simc(2, 10, 1, 1);
    expect(r.pi.kp).toBeCloseTo(2.5, 12);
    expect(r.pi.ti).toBeCloseTo(8, 12);
  });

  it('writes Kp(1 + 1/(Ti s) + Td s) as a transfer function', () => {
    const c = pidTF({ kp: 2, ti: 4, td: 0.5 });
    // (Kp Td s² + Kp s + Kp/Ti)/s = (s² + 2s + 0.5)/s.
    expect(c.num).toEqual([0.5, 2, 1]);
    expect(c.den).toEqual([0, 1]);
  });
});

const code = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    if (e instanceof ControlError) return e.code;
    throw e;
  }
  return 'none';
};

describe('impossible input', () => {
  const g = readTF('4/(s (s + 2))');
  const cases: [string, () => unknown][] = [
    ['pmRange', () => designLead(g, 120)],
    ['leadNotNeeded', () => designLead(readTF('1/(s + 1)'), 30)],
    ['errorTarget', () => designLead(g, 50, -1)],
    ['zetaRange', () => designLocusLead(g, 1.5, 2)],
    ['tsPositive', () => designLocusLead(g, 0.5, 0)],
    ['ultimatePositive', () => zieglerNichols(0, 1)],
    ['noUltimate', () => ultimate(readTF('1/(s + 1)'))],
    ['modelTimes', () => simc(1, -1, 0, 1)],
    ['tauCPositive', () => simc(1, 1, 0, 0)],
  ];
  it.each(cases)('names %s', (want, f) => expect(code(f)).toBe(want));
});

describe('lead-lag and missed targets', () => {
  it('lead-lag for 1/(s(s + 1)(s + 2)), Kv = 10, PM 50°: crossover at √2, Kv kept, PM met', () => {
    const g = readTF('1/(s (s + 1) (s + 2))');
    const d = designLeadLag(g, 50, 10, 5);
    // With K = 20 the phase of KG is −180° exactly at ω = √2 (the imaginary part of the cubic vanishes there).
    expect(d.values.wc).toBeCloseTo(Math.SQRT2, 9);
    const l = series(d.c, g);
    // Independent: |L(j√2)| = 1, and the margin is 180° + ∠L(j√2).
    const at = evalTF(l, cx(0, Math.SQRT2));
    expect(cabs(at)).toBeCloseTo(1, 9);
    const pm = 180 + (Math.atan2(at.im, at.re) * 180) / Math.PI;
    expect(pm).toBeGreaterThan(49.5);
    expect(pm).toBeLessThan(55);
    // Kv = lim s L(s), read at a small s.
    const s = 1e-10;
    expect(s * cabs(evalTF(l, cx(s)))).toBeCloseTo(10, 5);
    expect(rootsOf(feedback(l).den).every((r) => r.re < 0)).toBe(true);
    expect(d.missed).toBe(false);
  });

  it('flags a lead that misses its target: 1/(s(s + 1)(s + 2)), Kv 5, PM 45°', () => {
    const d = designLead(readTF('1/(s (s + 1) (s + 2))'), 45, 5, 5);
    expect(d.after.margins.pm).toBeLessThan(44.5);
    expect(d.missed).toBe(true);
    expect(d.steps[d.steps.length - 1].key).toBe('comp.missed');
  });
});
