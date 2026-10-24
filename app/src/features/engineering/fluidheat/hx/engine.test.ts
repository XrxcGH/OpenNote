import { describe, expect, it } from 'vitest';
import { CalcError } from '../numeric';
import {
  effectiveness,
  fromTemperatures,
  lmtd,
  maxEffectiveness,
  ntuFor,
  profile,
  rate,
  shellCorrection,
  size,
  type HxType,
} from './engine';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe('effectiveness-NTU relations at NTU 2, Cr 0.5', () => {
  it('matches the reference values', () => {
    expect(effectiveness('counter', 2, 0.5)).toBeCloseTo(0.7746, 4);
    expect(effectiveness('parallel', 2, 0.5)).toBeCloseTo(0.63348, 4);
    expect(effectiveness('shell', 2, 0.5)).toBeCloseTo(0.69309, 4);
    expect(effectiveness('crossUnmixed', 2, 0.5)).toBeCloseTo(0.73876, 4);
  });
  it('matches an independent evaluation of the counterflow and mixed cross-flow forms', () => {
    const e = Math.exp(-2 * 0.5);
    expect(effectiveness('counter', 2, 0.5)).toBeCloseTo((1 - e) / (1 - 0.5 * e), 13);
    expect(effectiveness('crossCmaxMixed', 2, 0.5)).toBeCloseTo(2 * (1 - Math.exp(-0.5 * (1 - Math.exp(-2)))), 13);
    expect(effectiveness('crossCminMixed', 2, 0.5)).toBeCloseTo(1 - Math.exp(-2 * (1 - Math.exp(-1))), 13);
  });
  it('handles Cr = 1 and Cr = 0', () => {
    expect(effectiveness('counter', 3, 1)).toBeCloseTo(0.75, 14);
    expect(effectiveness('parallel', 3, 1)).toBeCloseTo((1 - Math.exp(-6)) / 2, 14);
    for (const t of ['counter', 'parallel', 'shell', 'crossUnmixed'] as HxType[])
      expect(effectiveness(t, 1.5, 0)).toBeCloseTo(1 - Math.exp(-1.5), 14);
  });
  it('inverts to the same NTU, and refuses effectiveness the arrangement cannot reach', () => {
    for (const t of ['counter', 'parallel', 'shell', 'crossUnmixed', 'crossCmaxMixed', 'crossCminMixed'] as HxType[]) {
      const eps = effectiveness(t, 1.7, 0.6);
      expect(ntuFor(t, eps, 0.6)).toBeCloseTo(1.7, 8);
    }
    expect(() => ntuFor('parallel', 0.8, 0.5)).toThrow(/limit/);
    expect(maxEffectiveness('parallel', 0.5)).toBeCloseTo(1 / 1.5, 14);
    expect(() => ntuFor('counter', 0, 0.5)).toThrow(CalcError);
  });
});

describe('LMTD and the correction factor', () => {
  it('hot 150 to 90, cold 30 to 70, counterflow: LMTD 69.521 K', () => {
    expect(rel(lmtd(150 - 70, 90 - 30), 69.521)).toBeLessThan(1e-4);
    const r = fromTemperatures({ type: 'counter', thIn: 150, thOut: 90, tcIn: 30, tcOut: 70, q: 1e5 });
    expect(rel(r.lmtd, 69.521)).toBeLessThan(1e-4);
    expect(r.f).toBe(1);
    expect(r.ua).toBeCloseTo(1e5 / r.lmtd, 9);
  });
  it('same temperatures in one shell, two passes: P 0.3333, R 1.5, F 0.91048', () => {
    const r = fromTemperatures({ type: 'shell', thIn: 150, thOut: 90, tcIn: 30, tcOut: 70, q: 1e5 });
    expect(r.p).toBeCloseTo(1 / 3, 4);
    expect(r.r).toBeCloseTo(1.5, 12);
    expect(r.f).toBeCloseTo(0.91048, 4);
  });
  it('R = 1 uses the limiting form and equal end differences use the arithmetic mean', () => {
    expect(shellCorrection(0.3, 1)).toBeCloseTo(shellCorrection(0.3, 1 + 1e-7), 5);
    expect(lmtd(40, 40)).toBe(40);
  });
  it('rejects a temperature cross and an impossible shell program', () => {
    expect(() => lmtd(0, 10)).toThrow(/cross/);
    expect(() => fromTemperatures({ type: 'counter', thIn: 100, thOut: 80, tcIn: 60, tcOut: 110, q: 1 })).toThrow(
      CalcError,
    );
    expect(() => shellCorrection(0.9, 2)).toThrow(/impossible/);
    expect(() => fromTemperatures({ type: 'shell', thIn: 100, thOut: 120, tcIn: 20, tcOut: 40, q: 1 })).toThrow(
      CalcError,
    );
  });
});

describe('rating and sizing', () => {
  const base = { type: 'counter' as HxType, ch: 2000, cc: 4000, thIn: 150, tcIn: 30 };
  it('rates an exchanger: energy balance and the LMTD relation hold', () => {
    const r = rate({ ...base, ua: 3000 });
    expect(r.cr).toBe(0.5);
    expect(r.ntu).toBeCloseTo(1.5, 14);
    expect(r.q).toBeCloseTo(r.eps * 2000 * 120, 9);
    expect(base.ch * (150 - r.thOut)).toBeCloseTo(r.q, 8);
    expect(base.cc * (r.tcOut - 30)).toBeCloseTo(r.q, 8);
    expect(r.q).toBeCloseTo(3000 * r.f * r.lmtd, 6);
  });
  it('sizing from an outlet returns the UA that rating then reproduces', () => {
    const s = size({ ...base, thOut: 90 });
    expect(s.q).toBeCloseTo(2000 * 60, 9);
    const back = rate({ ...base, ua: s.ua });
    expect(back.thOut).toBeCloseTo(90, 7);
    expect(back.q).toBeCloseTo(s.q, 4);
    const viaDuty = size({ ...base, q: 120000 });
    expect(viaDuty.ua).toBeCloseTo(s.ua, 9);
  });
  it('a condenser (very large Ch) has Cr = 0', () => {
    const r = rate({ ...base, ch: Infinity, ua: 4000 });
    expect(r.cr).toBe(0);
    expect(r.eps).toBeCloseTo(1 - Math.exp(-1), 14);
    expect(r.thOut).toBe(150);
  });
  it('rejects bad inputs', () => {
    expect(() => rate({ ...base, ua: 0 })).toThrow(CalcError);
    expect(() => rate({ ...base, ch: 0, ua: 1 })).toThrow(/above zero/);
    expect(() => rate({ ...base, thIn: 20, ua: 1 })).toThrow(/hotter/);
    expect(() => size({ ...base })).toThrow(/duty/);
    expect(() => size({ ...base, q: 1e6 })).toThrow(/more than/);
    expect(() => size({ ...base, q: -5 })).toThrow(CalcError);
  });
  it('counterflow profile ends match the outlets; parallel starts at the inlets', () => {
    const c = profile({ ...base, ua: 3000 });
    const r = rate({ ...base, ua: 3000 });
    expect(c.hot[0]).toBeCloseTo(150, 9);
    expect(c.hot[c.hot.length - 1]).toBeCloseTo(r.thOut, 6);
    expect(c.cold[0]).toBeCloseTo(r.tcOut, 6);
    expect(c.cold[c.cold.length - 1]).toBeCloseTo(30, 6);
    const p = profile({ ...base, type: 'parallel', ua: 3000 });
    const rp = rate({ ...base, type: 'parallel', ua: 3000 });
    expect(p.cold[0]).toBeCloseTo(30, 9);
    expect(p.hot[p.hot.length - 1]).toBeCloseTo(rp.thOut, 6);
    expect(p.cold[p.cold.length - 1]).toBeCloseTo(rp.tcOut, 6);
    expect(() => profile({ ...base, type: 'shell', ua: 1 })).toThrow(CalcError);
  });
});
