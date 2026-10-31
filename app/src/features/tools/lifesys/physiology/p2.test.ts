// The P-V loop, ventricular-arterial coupling, and Krogh cylinder against values computed independently in Python
// (SciPy LSODA for the beating ventricle, solve_bvp for the tissue cylinder) and by hand for the coupling lines.
import { describe, expect, it } from 'vitest';
import { LsError } from '../num/errors';
import {
  activation,
  bloodContent,
  couplingResult,
  kroghP,
  kroghResult,
  loopArea,
  po2ForContent,
  pvLoopResult,
  simulatePv,
  type PvParams,
} from './engine';

const BASE: PvParams = {
  hr: 75,
  ts: 0.3,
  emax: 2.5,
  emin: 0.08,
  v0: 10,
  pla: 8,
  rmv: 0.005,
  rao: 0.01,
  rs: 1,
  c: 1.6,
  beats: 10,
};
const rel = (actual: number, expected: number, tol: number) =>
  expect(Math.abs(actual - expected) / Math.abs(expected)).toBeLessThan(tol);
const valueOf = (result: { rows: { label: string; value: number | string }[] }, label: string) => {
  const found = result.rows.find((r) => r.label === label);
  if (!found) throw new Error(`no row ${label}`);
  return found.value as number;
};

describe('time-varying elastance P-V loop', () => {
  it('matches an independent LSODA run of the same model (10 beats)', () => {
    const beat = simulatePv(BASE);
    rel(beat.edv, 109.97988, 2e-4);
    rel(beat.esv, 47.4751, 1e-3);
    rel(beat.edv - beat.esv, 62.50478, 2e-3);
    rel(beat.peak, 95.4072, 1e-3);
    rel(beat.sbp, 94.11864, 1e-3);
    rel(beat.dbp, 61.67226, 1e-3);
    rel(beat.work, 5133.851, 3e-3);
  });

  it('reports EF, cardiac output, and stroke work in joules', () => {
    const result = pvLoopResult(BASE);
    rel(valueOf(result, 'physiology.r.ef'), 56.83292, 2e-3);
    rel(valueOf(result, 'physiology.r.co'), 4.687858, 2e-3);
    rel(valueOf(result, 'physiology.r.workJ'), 5133.851 * 133.322e-6, 3e-3);
    expect(result.plots?.[0].series[0].points.length).toBeGreaterThan(100);
  });

  it('balances inflow and outflow over a settled beat', () => {
    // Over a settled beat the runoff through Rs equals the stroke volume (mean Pa × T / Rs ≈ SV).
    const beat = simulatePv({ ...BASE, beats: 20 });
    let integral = 0;
    for (let i = 1; i < beat.t.length; i += 1)
      integral += ((beat.pa[i] + beat.pa[i - 1]) / 2) * (beat.t[i] - beat.t[i - 1]);
    rel(integral / BASE.rs, beat.edv - beat.esv, 5e-3);
  });

  it('a stronger ventricle (higher Emax) ejects more', () => {
    const weak = simulatePv(BASE);
    const strong = simulatePv({ ...BASE, emax: 4 });
    expect(strong.esv).toBeLessThan(weak.esv);
  });

  it('activation is a half sine over systole and 0 in diastole, repeating each beat', () => {
    expect(activation(0.15, 0.8, 0.3)).toBeCloseTo(1, 12);
    expect(activation(0.5, 0.8, 0.3)).toBe(0);
    expect(activation(0.95, 0.8, 0.3)).toBeCloseTo(1, 12);
  });

  it('measures a loop area by the shoelace formula', () => {
    expect(
      loopArea([
        [50, 10],
        [120, 10],
        [120, 100],
        [50, 100],
      ]),
    ).toBeCloseTo(6300, 9);
  });

  it('rejects impossible settings with clear messages', () => {
    expect(() => simulatePv({ ...BASE, emax: 0.05 })).toThrow(LsError);
    expect(() => simulatePv({ ...BASE, ts: 0.9 })).toThrow(LsError);
    expect(() => simulatePv({ ...BASE, hr: 0 })).toThrow(LsError);
    expect(() => simulatePv({ ...BASE, v0: -1 })).toThrow(LsError);
    expect(() => simulatePv({ ...BASE, beats: 0 })).toThrow(LsError);
    expect(() => simulatePv({ ...BASE, beats: 1e6 })).toThrow(LsError);
  });
});

describe('ventricular-arterial coupling', () => {
  it('Ees 2, V0 10, EDV 120, Ea 2 gives SV 55, ESV 65, ESP 110, EF 45.8333%', () => {
    const r = couplingResult(2, 10, 120, 2);
    // By hand: SV = 2 × 110 / 4 = 55; ESV = 120 − 55; ESP = 2 × 55; EF = 55 / 120; PE = 110 × 55 / 2.
    expect(valueOf(r, 'physiology.r.sv')).toBeCloseTo(55, 10);
    expect(valueOf(r, 'physiology.r.esv')).toBeCloseTo(65, 10);
    expect(valueOf(r, 'physiology.r.esp')).toBeCloseTo(110, 10);
    expect(valueOf(r, 'physiology.r.ef')).toBeCloseTo(45.833333333, 8);
    expect(valueOf(r, 'physiology.r.ratio')).toBeCloseTo(1, 12);
    expect(valueOf(r, 'physiology.r.pe')).toBeCloseTo(3025, 9);
  });

  it('rejects an EDV at or below V0, and non-positive slopes', () => {
    expect(() => couplingResult(2, 120, 120, 2)).toThrow(LsError);
    expect(() => couplingResult(0, 10, 120, 2)).toThrow(LsError);
    expect(() => couplingResult(2, 10, 120, -1)).toThrow(LsError);
  });
});

describe('Krogh cylinder', () => {
  const base = { pc: 40, rcUm: 3, rUm: 30, d: 1.5e-5, alpha: 3e-5, hb: null, speed: null, length: null };

  it('edge PO₂ matches an independent BVP solution (rest and exercise)', () => {
    expect(valueOf(kroghResult({ ...base, m: 0.5 }), 'physiology.r.kroghEdge')).toBeCloseTo(38.493679089, 6);
    expect(valueOf(kroghResult({ ...base, m: 5 }), 'physiology.r.kroghEdge')).toBeCloseTo(24.936790892, 6);
  });

  it('the profile at 20 µm and the critical radius match the BVP', () => {
    const m = 5 / 6000;
    const k = 1.5e-5 * 3e-5;
    expect(kroghP(40, m, k, 3e-4, 30e-4, 20e-4)).toBeCloseTo(26.000851978, 6);
    expect(valueOf(kroghResult({ ...base, m: 5 }), 'physiology.r.kroghCritical')).toBeCloseTo(44.354414142, 5);
  });

  it('satisfies the diffusion equation K(P″ + P′/r) = M with no flux at the edge', () => {
    const m = 2 / 6000;
    const k = 4.5e-10;
    const rc = 3e-4;
    const big = 25e-4;
    const P = (r: number) => kroghP(40, m, k, rc, big, r);
    const h = 1e-6;
    for (const r of [5e-4, 12e-4, 20e-4]) {
      const d1 = (P(r + h) - P(r - h)) / (2 * h);
      const d2 = (P(r + h) - 2 * P(r) + P(r - h)) / (h * h);
      rel(k * (d2 + d1 / r), m, 1e-3);
    }
    expect(Math.abs((P(big + h) - P(big - h)) / (2 * h))).toBeLessThan(1);
    expect(P(rc)).toBeCloseTo(40, 12);
  });

  it('the fall along the capillary matches the independent mass balance', () => {
    const r = kroghResult({ ...base, pc: 95, m: 5, hb: 15, speed: 0.5, length: 1 });
    expect(valueOf(r, 'physiology.r.kroghContent')).toBeCloseTo(19.859495126, 6);
    expect(valueOf(r, 'physiology.r.kroghVenousContent')).toBeCloseTo(3.359495126, 6);
    expect(valueOf(r, 'physiology.r.kroghVenous')).toBeCloseTo(13.701063613, 5);
    const r2 = kroghResult({ ...base, pc: 95, m: 2, hb: 15, speed: 0.5, length: 0.5 });
    expect(valueOf(r2, 'physiology.r.kroghVenous')).toBeCloseTo(46.03416545, 5);
  });

  it('inverts blood content to PO₂ and handles empty blood', () => {
    expect(po2ForContent(bloodContent(30, 14), 14)).toBeCloseTo(30, 8);
    expect(po2ForContent(0, 14)).toBe(0);
    const empty = kroghResult({ ...base, pc: 95, m: 20, hb: 15, speed: 0.5, length: 1 });
    expect(valueOf(empty, 'physiology.r.kroghVenous')).toBe(0);
    expect(empty.steps.some((s) => s.key === 'physiology.s.kroghEmpty')).toBe(true);
  });

  it('rejects a cylinder no wider than its capillary, partial capillary inputs, and zero uptake', () => {
    expect(() => kroghResult({ ...base, m: 1, rUm: 3 })).toThrow(LsError);
    expect(() => kroghResult({ ...base, m: 1, hb: 15 })).toThrow(LsError);
    expect(() => kroghResult({ ...base, m: 0 })).toThrow(LsError);
    expect(() => kroghResult({ ...base, m: 1, d: -1 })).toThrow(LsError);
  });
});
