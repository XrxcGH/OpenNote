import { describe, expect, it } from 'vitest';
import { C } from '../shared/constants';
import { PhysicsError } from '../shared/errors';
import { chainDispersion, fermiEnergy, freeElectron, kpF, kronigPenney } from './bands';
import {
  MATERIALS,
  carriers,
  cellCurrent,
  intrinsic,
  junction,
  lambertWExp,
  mos,
  solarCell,
  transport,
} from './devices';

const rel = (got: number, want: number) => Math.abs(got / want - 1);
const item = (calc: { items: readonly { key: string; value: number }[] }, key: string) =>
  calc.items.find((one) => one.key === key)!.value;

describe('free electrons and bands', () => {
  it('gives the Fermi energy 7.0328 eV for copper', () => {
    expect(Math.abs(item(freeElectron(8.47e28, 1, 3), 'fermiEnergy') - 7.0328)).toBeLessThan(1e-4);
  });

  it('gives the two-dimensional density of states m/(πħ²)', () => {
    const calc = freeElectron(1e16, 0.067, 2);
    expect(rel(item(calc, 'dos') / C.e, (0.067 * C.me) / (Math.PI * C.hbar ** 2))).toBeLessThan(1e-12);
    expect(fermiEnergy(1e9, C.me, 1)).toBeCloseTo((C.hbar ** 2 * (Math.PI * 5e8) ** 2) / (2 * C.me), 30);
    expect(() => freeElectron(0, 1, 3)).toThrow(PhysicsError);
  });

  it('finds the first Kronig-Penney band from αa = 2.2505 to π for P = 3π/2', () => {
    const calc = kronigPenney((3 * Math.PI) / 2, 2);
    const bands = calc.items.filter((one) => one.key === 'band');
    expect(Math.abs(bands[0]!.value - 2.2505)).toBeLessThan(1e-4);
    // The lower edge solves f = 1 and the band closes at f(π) = −1.
    expect(kpF((3 * Math.PI) / 2, bands[0]!.value)).toBeCloseTo(1, 9);
    expect((bands[0] as { text?: string }).text).toContain('3.141593');
    expect(() => kronigPenney(0, 2)).toThrow(PhysicsError);
  });

  it('gives a tight-binding width of 4t and the diatomic zone-edge frequencies', () => {
    expect(item(chainDispersion({ kind: 'tight', a: 3e-10, e0: 0, hop: 0.5, k: 0, m1: 0, m2: 0 }), 'bandwidth')).toBe(
      2,
    );
    const di = chainDispersion({ kind: 'di', a: 5e-10, e0: 0, hop: 0, k: 10, m1: 1e-26, m2: 4e-26 });
    expect(item(di, 'acousticEdge')).toBeCloseTo(Math.sqrt(20 / 4e-26), 0);
    expect(item(di, 'opticalEdge')).toBeCloseTo(Math.sqrt(20 / 1e-26), 0);
    const zoneEdge = di.plot!.series[1]!.points.at(-1)!;
    expect(rel(zoneEdge[1], Math.sqrt(20 / 1e-26))).toBeLessThan(1e-9);
  });
});

describe('semiconductors', () => {
  it('gives n_i = 6.6759e9 per cm³ for Nc 2.8e19, Nv 1.04e19, Eg 1.12 eV at 300 K', () => {
    expect(rel(intrinsic(2.8e25, 1.04e25, 1.12, 300) / 1e6, 6.6759e9)).toBeLessThan(1e-3);
  });

  it('obeys the mass-action law and gives n = N_D for full ionization', () => {
    const calc = carriers(MATERIALS.si, 300, { nd: 1e22, na: 0, ed: 0, ea: 0 });
    const ni = item(calc, 'ni');
    expect(rel(item(calc, 'n'), 1e22)).toBeLessThan(1e-6);
    expect(rel(item(calc, 'n') * item(calc, 'p'), ni * ni)).toBeLessThan(1e-9);
    // Varshni: Eg(300 K) = 1.17 − 4.73e-4 × 300² / 936.
    expect(item(calc, 'gapEnergy')).toBeCloseTo(1.17 - (4.73e-4 * 90000) / 936, 12);
  });

  it('leaves donors partly neutral when they are shallow but the doping is heavy', () => {
    const calc = carriers(MATERIALS.si, 300, { nd: 1e25, na: 0, ed: 0.045, ea: 0.045 });
    expect(item(calc, 'ionizedDonors')).toBeLessThan(1);
    expect(item(calc, 'ionizedDonors')).toBeGreaterThan(0.3);
  });

  it('gives the Hall coefficient −1/(qn) for electrons alone', () => {
    const calc = transport(1e22, 0, 0.14, 0.045, 300, 1e4, 0);
    expect(rel(item(calc, 'hall') / 1e6, -1 / (C.e * 1e22))).toBeLessThan(1e-12);
    expect(() => transport(0, 0, 0.1, 0.1, 300, 0, 0)).toThrow(PhysicsError);
  });
});

describe('devices', () => {
  const pn = { na: 1e23, nd: 1e22, ni: 1e16, t: 300, epsR: 11.7, v: 0, area: 1e-8, i0: 0, ideality: 1 };

  it('gives V_bi 0.77384 V and W 0.33178 µm for the planning junction', () => {
    const calc = junction(pn);
    expect(Math.abs(item(calc, 'vbi') - 0.77384)).toBeLessThan(1e-4);
    expect(Math.abs(item(calc, 'width') * 1e6 - 0.33178)).toBeLessThan(1e-4);
    // Charge balance: N_A x_p = N_D x_n.
    expect(rel(item(calc, 'xp') * 1e23, item(calc, 'xn') * 1e22)).toBeLessThan(1e-12);
    expect(() => junction({ ...pn, v: 1 })).toThrow(PhysicsError);
  });

  it('gives a MOS threshold from the textbook formula', () => {
    const m = { na: 1e23, ni: 1e16, t: 300, tox: 10e-9, epsOx: 3.9, epsS: 11.7, phiMs: -0.9, qox: 0 };
    const vt = (C.kB * 300) / C.e;
    const phiF = vt * Math.log(1e7);
    const cox = (3.9 * C.eps0) / 10e-9;
    const want = -0.9 + 2 * phiF + Math.sqrt(2 * 11.7 * C.eps0 * C.e * 1e23 * 2 * phiF) / cox;
    expect(rel(item(mos(m), 'vt'), want)).toBeLessThan(1e-12);
  });

  it('gives V_oc 0.56414 V for I_sc 3 A and I₀ 1e-9 A', () => {
    const cell = { il: 3, i0: 1e-9, ideality: 1, t: 300, rs: 0, rsh: 0, irradiance: 1000, area: 0.0156 };
    expect(Math.abs(item(solarCell(cell), 'voc') - 0.56414)).toBeLessThan(1e-4);
    const ff = item(solarCell(cell), 'fillFactor');
    expect(ff).toBeGreaterThan(0.8);
    expect(ff).toBeLessThan(0.9);
  });

  it('solves the single-diode equation exactly with series and shunt resistance', () => {
    expect(lambertWExp(1)).toBeCloseTo(1, 14);
    expect(lambertWExp(1000) + Math.log(lambertWExp(1000))).toBeCloseTo(1000, 9);
    const cell = { il: 3, i0: 1e-9, ideality: 1.2, t: 300, rs: 0.02, rsh: 50, irradiance: 0, area: 0 };
    for (const v of [0, 0.3, 0.55]) {
      const i = cellCurrent(cell, v);
      const a = 1.2 * ((C.kB * 300) / C.e);
      const residual = 3 - 1e-9 * Math.expm1((v + i * 0.02) / a) - (v + i * 0.02) / 50 - i;
      expect(Math.abs(residual)).toBeLessThan(1e-9);
    }
    expect(() => solarCell({ ...cell, il: 0 })).toThrow(PhysicsError);
  });
});
