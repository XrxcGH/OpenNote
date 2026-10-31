import { describe, expect, it } from 'vitest';
import { CivilError } from '../core/types';
import {
  absoluteMaxMoment,
  beamDiagrams,
  cantilever,
  fixedEnd,
  influence,
  maxEndShear,
  modalCombination,
  momentDistribution,
  newmark,
  portal,
  responseSpectrum,
  slopeDeflection,
  trussInfluence,
} from './engine';

const within = (actual: number, expected: number, tol: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
const key = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (error instanceof CivilError) return error.key;
    throw error;
  }
  throw new Error('expected a CivilError');
};

describe('continuous beams', () => {
  const span = (L: number, w: number) => ({ L, EI: 1, w, P: 0, a: 0 });

  it('gives the plan two-span beam', () => {
    const r = momentDistribution([span(6, 10), span(6, 10)], 'pinned', 'pinned');
    within(r.moments[0]![1], 45, 1e-6);
    within(r.moments[1]![0], -45, 1e-6);
    within(r.reactions[0]!, 22.5, 1e-6);
    within(r.reactions[1]!, 75, 1e-6);
    within(r.reactions[2]!, 22.5, 1e-6);
  });

  it('gives the plan fixed-end moments', () => {
    const [l, r] = fixedEnd(8, { w: 0, P: 40, a: 4 });
    within(-l, 40, 1e-9);
    within(r, 40, 1e-9);
  });

  it('agrees with slope-deflection on an unequal three-span beam', () => {
    const spans = [
      { L: 5, EI: 2, w: 12, P: 0, a: 0 },
      { L: 8, EI: 3, w: 0, P: 60, a: 3 },
      { L: 4, EI: 1, w: 20, P: 0, a: 0 },
    ];
    const md = momentDistribution(spans, 'fixed', 'pinned');
    const sd = slopeDeflection(spans, 'fixed', 'pinned');
    md.moments.forEach((pair, i) => {
      within(pair[0], sd[i]![0], 1e-6);
      within(pair[1], sd[i]![1], 1e-6);
    });
    within(md.moments[2]![1], 0, 1e-6);
    const total = md.reactions.reduce((s, v) => s + v, 0);
    within(total, 12 * 5 + 60 + 20 * 4, 1e-6);
  });

  it('draws moments that meet the end moments', () => {
    const spans = [span(6, 10), span(6, 10)];
    const r = momentDistribution(spans, 'pinned', 'pinned');
    const d = beamDiagrams(spans, r, 60);
    within(d[60]!.M, -45, 1e-6);
    // The sagging peak, wL²·(9/128), falls between samples, so allow the sampling error.
    within(Math.max(...d.slice(0, 61).map((p) => p.M)), 22.5 ** 2 / 20, 0.02);
  });

  it('refuses a span with no length', () => {
    expect(key(() => momentDistribution([span(0, 10)], 'pinned', 'pinned'))).toBe('errors.positive');
  });
});

describe('influence lines and moving loads', () => {
  it('gives the plan midspan moment line', () => {
    within(influence('M', 20, 10, 10), 5, 1e-12);
    within(influence('M', 20, 10, 5), 2.5, 1e-12);
    within(influence('V', 20, 10, 9.999), -0.49995, 1e-9);
  });

  it('gives the plan absolute maximum moment', () => {
    const r = absoluteMaxMoment(
      [
        { P: 100, d: 0 },
        { P: 100, d: 4 },
      ],
      20,
    );
    within(r.M, 810, 1e-6);
    expect([9, 11]).toContain(Math.round(r.x));
  });

  it('gives the end shear with the heavy axle at the support', () => {
    const r = maxEndShear(
      [
        { P: 50, d: 0 },
        { P: 150, d: 5 },
      ],
      20,
    );
    within(r.V, 150 + 50 * (15 / 20), 1e-9);
  });

  it('reads truss member forces off the existing truss solver', () => {
    // A three-panel Pratt truss with 3 m panels, 3 m deep: the middle bottom chord carries M/h at midspan.
    const joints = [
      { x: 0, y: 0, support: 1 },
      { x: 3, y: 0, support: 0 },
      { x: 6, y: 0, support: 0 },
      { x: 9, y: 0, support: 2 },
      { x: 3, y: 3, support: 0 },
      { x: 6, y: 3, support: 0 },
    ];
    const members = [
      { a: 1, b: 2 },
      { a: 2, b: 3 },
      { a: 3, b: 4 },
      { a: 5, b: 6 },
      { a: 1, b: 5 },
      { a: 2, b: 5 },
      { a: 3, b: 6 },
      { a: 6, b: 4 },
      { a: 2, b: 6 },
    ];
    const il = trussInfluence({ joints, members }, 2, [2, 3]);
    // The section through chord 2-3 also cuts diagonal 2-6 and top chord 5-6, so take moments about joint 6:
    // a unit load at x = 3 leaves R = 1/3 at the right support, M = 1 at x = 6, and the chord carries M/h = 1/3.
    within(il[0]!, 1 / 3, 1e-9);
  });
});

describe('approximate lateral analysis', () => {
  it('gives the plan portal frame', () => {
    const p = portal([{ V: 20, h: 4 }], 1, 6);
    within(p.rows[0]!.ext, 10, 1e-12);
    within(p.rows[0]!.Mext, 20, 1e-12);
  });

  it('balances overturning by column axial forces', () => {
    const c = cantilever(
      [
        { V: 10, h: 3 },
        { V: 30, h: 4 },
      ],
      [0, 6, 12],
    );
    within(c[0]!.Mo, 15, 1e-12);
    within(c[1]!.Mo, 10 * 5 + 20 * 2, 1e-12);
    within(c[1]!.axial[2]! * 6 - c[1]!.axial[0]! * 6, 90, 1e-9);
  });
});

describe('dynamics', () => {
  it('doubles the static deflection under a suddenly applied load', () => {
    const k = 100;
    const m = 1;
    const T = 2 * Math.PI * Math.sqrt(m / k);
    const dt = T / 400;
    const r = newmark(m, 0, k, new Array<number>(1200).fill(5), dt);
    const peak = Math.max(...r.u);
    expect(Math.abs(peak / (2 * (5 / k)) - 1)).toBeLessThan(0.005);
  });

  it('gives a spectrum near the resonant harmonic solution', () => {
    // An undamped oscillator driven at resonance grows by π u_st per cycle; check the spectrum is finite and grows.
    const dt = 0.01;
    const ag = Array.from({ length: 500 }, (_, i) => Math.sin(2 * Math.PI * i * dt));
    const s = responseSpectrum(ag, dt, 0.05, [0.5, 1, 2]);
    expect(s[1]!.Sd).toBeGreaterThan(s[0]!.Sd);
    within(s[1]!.Sa, (2 * Math.PI) ** 2 * s[1]!.Sd, 1e-9);
  });

  it('combines well-separated modes like SRSS', () => {
    const c = modalCombination([3, 4], [1, 0.1], 0.05);
    within(c.srss, 5, 1e-12);
    within(c.cqc, 5, 0.01);
  });
});
