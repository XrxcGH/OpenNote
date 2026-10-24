// IAPWS-IF97 against the verification values of the release (R7-97(2012)), then against the IAPWS-95 saturated
// table the chemistry tools ship, and against itself: the region boundaries meet, and h - u = p v everywhere.
/* eslint-disable opennote/feature-boundaries -- The test compares with the chemistry tools' IAPWS-95 table. */
import { describe, expect, it } from 'vitest';
import { STEAM_BY_P, STEAM_BY_T } from '../../../tools/chem/data/steamData';
import { psat, pB23, region1, region2, region3, region5, tB23, tsat } from './if97';
import { fromPH, fromPS, fromPX, fromTP, fromTX } from './water';

const rel = (actual: number, expected: number) => Math.abs(actual / expected - 1);

describe('IAPWS-IF97 verification values', () => {
  it('region 1 at 300 K, 3 MPa', () => {
    const s = region1(300, 3000);
    expect(rel(s.v, 0.100215168e-2)).toBeLessThan(1e-8);
    expect(rel(s.h, 115.331273)).toBeLessThan(1e-8);
    expect(rel(s.u, 112.324818)).toBeLessThan(1e-8);
    expect(rel(s.s, 0.392294792)).toBeLessThan(1e-8);
    expect(rel(s.cp, 4.17301218)).toBeLessThan(1e-8);
    expect(rel(s.w, 1507.73921)).toBeLessThan(1e-8);
  });

  it('region 1 at 500 K, 3 MPa', () => {
    const s = region1(500, 3000);
    expect(rel(s.v, 0.1202418e-2)).toBeLessThan(1e-8);
    expect(rel(s.h, 975.542239)).toBeLessThan(1e-8);
    expect(rel(s.s, 2.58041912)).toBeLessThan(1e-8);
    expect(rel(s.w, 1240.71337)).toBeLessThan(1e-8);
  });

  it('region 2 at 700 K, 30 MPa', () => {
    const s = region2(700, 30000);
    expect(rel(s.v, 0.542946619e-2)).toBeLessThan(1e-8);
    expect(rel(s.h, 2631.49474)).toBeLessThan(1e-8);
    expect(rel(s.u, 2468.61076)).toBeLessThan(1e-8);
    expect(rel(s.s, 5.17540298)).toBeLessThan(1e-8);
    expect(rel(s.cp, 10.3505092)).toBeLessThan(1e-8);
    expect(rel(s.w, 480.386523)).toBeLessThan(1e-8);
  });

  it('region 3 at 650 K and 500 kg/m3', () => {
    const s = region3(500, 650);
    expect(rel(s.p, 25583.7018)).toBeLessThan(1e-8);
    expect(rel(s.h, 1863.43019)).toBeLessThan(1e-8);
    expect(rel(s.s, 4.05427273)).toBeLessThan(1e-8);
    expect(rel(s.w, 502.005554)).toBeLessThan(1e-8);
  });

  it('region 4: psat at 300 and 500 K, Tsat at 0.1 and 10 MPa', () => {
    expect(rel(psat(300), 3.53658941)).toBeLessThan(1e-8);
    expect(rel(psat(500), 2638.89776)).toBeLessThan(1e-8);
    expect(rel(tsat(100), 372.755919)).toBeLessThan(1e-8);
    expect(rel(tsat(10000), 584.149488)).toBeLessThan(1e-8);
  });

  it('region 5 at 1500 K, 0.5 MPa', () => {
    const s = region5(1500, 500);
    expect(rel(s.v, 1.3845509)).toBeLessThan(1e-8);
    expect(rel(s.h, 5219.76855)).toBeLessThan(1e-8);
    expect(rel(s.s, 9.65408875)).toBeLessThan(1e-8);
  });

  it('the B23 boundary passes through 623.15 K and 16.5291643 MPa both ways', () => {
    expect(rel(pB23(623.15), 16529.1643)).toBeLessThan(1e-8);
    expect(rel(tB23(16529.1643), 623.15)).toBeLessThan(1e-8);
  });
});

describe('IF97 against the IAPWS-95 saturated table', () => {
  for (const kPa of [10, 1000, 8000]) {
    it(`hf, hg, sf, and sg agree within 0.1 % at ${kPa} kPa`, () => {
      const row = STEAM_BY_P.find((one) => one[1] === kPa)!;
      const f = fromPX(kPa, 0);
      const g = fromPX(kPa, 1);
      expect(rel(f.h, row[7])).toBeLessThan(1e-3);
      expect(rel(g.h, row[9])).toBeLessThan(1e-3);
      expect(rel(f.s, row[10])).toBeLessThan(1e-3);
      expect(rel(g.s, row[12])).toBeLessThan(1e-3);
      expect(Math.abs(f.T - 273.15 - row[0])).toBeLessThan(0.02);
    });
  }
});

describe('IF97 states from two properties', () => {
  it('finds T from p and h or s and gives back the same state', () => {
    for (const [T, p] of [
      [300, 3000],
      [500, 3000],
      [700, 30000],
      [650, 25583.7018],
      [1500, 500],
      [640, 22000],
      [450, 100],
    ]) {
      const state = fromTP(T, p);
      expect(fromPH(p, state.h).T).toBeCloseTo(T, 6);
      expect(fromPS(p, state.s).T).toBeCloseTo(T, 6);
      expect(state.h - state.u).toBeCloseTo(state.p * state.v, 8);
    }
  });

  it('a mixture from p and h has the lever-rule quality, and (T, x) matches (p, x)', () => {
    const f = fromPX(1000, 0);
    const g = fromPX(1000, 1);
    const mixed = fromPH(1000, f.h + 0.3 * (g.h - f.h));
    expect(mixed.phase).toBe('mixture');
    expect(mixed.x).toBeCloseTo(0.3, 10);
    expect(fromTX(mixed.T, 0.3).h).toBeCloseTo(mixed.h, 4);
  });

  // The IAPWS-95 saturation table at 360 and 370 C (by T) and 20 MPa (by p). IF97 region 3 departs from IAPWS-95
  // by a few tenths of a percent this close to the critical point: 0.5 % on v and 0.2 % on h.
  it.each([
    ['T', 360],
    ['T', 370],
    ['p', 20000],
  ] as const)('saturated liquid and vapor in region 3 (%s = %s) match the IAPWS-95 table', (by, value) => {
    const table = by === 'T' ? STEAM_BY_T : STEAM_BY_P;
    const row = table.find((r) => r[by === 'T' ? 0 : 1] === value);
    if (!row) throw new Error('no table row');
    const [tC, p, vf, vg, , , , hf, , hg] = row;
    const f = by === 'T' ? fromTX(tC + 273.15, 0) : fromPX(p, 0);
    const g = by === 'T' ? fromTX(tC + 273.15, 1) : fromPX(p, 1);
    expect(f.sat?.liquid.region).toBe(3);
    expect(rel(f.v, vf)).toBeLessThan(5e-3);
    expect(rel(f.h, hf)).toBeLessThan(2e-3);
    expect(rel(g.v, vg)).toBeLessThan(5e-3);
    expect(rel(g.h, hg)).toBeLessThan(2e-3);
    expect(rel(f.p, p)).toBeLessThan(2e-3);
  });

  // IAPWS SR5-05 (2016), the backward v(T, p) check values for subregions 3a and 3c, which lie below the critical
  // temperature on the liquid side. The backward equations agree with IF97 to about 1e-5.
  it.each([
    [630, 50000, 1.4708531e-3],
    [630, 20000, 1.761696406e-3],
    [650, 30000, 1.819560617e-3],
  ])('liquid-like region 3 at %s K and %s kPa matches SR5-05', (T, p, v) => {
    expect(rel(fromTP(T, p).v, v)).toBeLessThan(2e-5);
  });

  // IAPWS SR3-03 (2014), the backward T(p, h) check values in region 3; those equations are within 25 mK of IF97.
  it.each([
    [20000, 1700, 629.3083892],
    [100000, 2100, 733.6163014],
  ])('region 3 from p = %s kPa and h = %s kJ/kg is compressed liquid at the SR3-03 temperature', (p, h, T) => {
    const s = fromPH(p, h);
    expect(s.phase).not.toBe('mixture');
    expect(Math.abs(s.T - T)).toBeLessThan(0.025);
  });

  it('regions 1 and 2 meet at the saturation line and regions 2 and 3 at B23', () => {
    const T = 600;
    const p = psat(T);
    const liquid = region1(T, p);
    const vapor = region2(T, p);
    // Clausius-Clapeyron: the Gibbs energies are equal at saturation.
    expect(Math.abs(liquid.h - T * liquid.s - (vapor.h - T * vapor.s))).toBeLessThan(0.05);
    const pb = pB23(700);
    const two = region2(700, pb);
    const three = fromTP(700, pb * 1.000001);
    expect(rel(three.v, two.v)).toBeLessThan(1e-3);
  });

  it('names the phase of a state', () => {
    expect(fromTP(300, 100).phase).toBe('liquid');
    expect(fromTP(500, 100).phase).toBe('vapor');
    expect(fromTP(700, 30000).phase).toBe('supercritical');
    expect(fromPX(100, 0).phase).toBe('satLiquid');
  });
});
