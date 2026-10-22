// The property tables against well-known values (steam tables in any thermodynamics text, the gas table, materials).
import { describe, expect, it } from 'vitest';
import { gasCp, gasProperties, gases, steamAt, steamRows } from './lookup';
import { MATERIALS, MATERIAL_SOURCES, searchMaterials } from './materials';

describe('saturated steam', () => {
  it('matches the standard rows', () => {
    const boil = steamAt('T', 100)!;
    expect(boil.P).toBeCloseTo(101.42, 1);
    expect(boil.hf).toBeCloseTo(419.17, 1);
    expect(boil.hfg).toBeCloseTo(2256.4, 0);
    expect(boil.hg).toBeCloseTo(2675.6, 0);
    expect(boil.vg).toBeCloseTo(1.672, 2);
    expect(boil.sg).toBeCloseTo(7.3545, 2);
    const mpa = steamAt('P', 1000)!;
    expect(mpa.T).toBeCloseTo(179.88, 1);
    expect(mpa.hg).toBeCloseTo(2777.1, 0);
    expect(mpa.vg).toBeCloseTo(0.1944, 3);
    expect(steamAt('P', 101.325)!.T).toBeCloseTo(99.97, 1);
    expect(steamAt('T', 0.01)!.P).toBeCloseTo(0.6117, 2);
  });
  it('interpolates between rows and says so', () => {
    const mid = steamAt('T', 102)!;
    expect(mid.interpolated).toBe(true);
    expect(mid.P).toBeGreaterThan(steamAt('T', 100)!.P);
    expect(mid.P).toBeLessThan(steamAt('T', 110)!.P);
    expect(mid.hf).toBeCloseTo(427.6, 0);
  });
  it('stays inside the table and cites every row', () => {
    expect(steamAt('T', -5)).toBeNull();
    expect(steamAt('P', 30000)).toBeNull();
    expect(steamAt('T', NaN)).toBeNull();
    for (const row of [...steamRows('T'), ...steamRows('P')]) {
      expect(row.source).toContain('IAPWS');
      expect(row.hfg).toBeCloseTo(row.hg - row.hf, 1);
      expect(row.sfg).toBeCloseTo(row.sg - row.sf, 3);
    }
  });
});

describe('ideal gases', () => {
  it('matches textbook values at 300 K', () => {
    const air = gasProperties('Air', 300)!;
    expect(air.cp).toBeCloseTo(1.005, 2);
    expect(air.cv).toBeCloseTo(0.718, 2);
    expect(air.R).toBeCloseTo(0.287, 3);
    expect(air.k).toBeCloseTo(1.4, 2);
    expect(gasProperties('Helium', 300)!.k).toBeCloseTo(1.667, 2);
    expect(gasProperties('Carbon dioxide', 300)!.cp).toBeCloseTo(0.846, 2);
    expect(gasProperties('Hydrogen', 300)!.cp).toBeCloseTo(14.3, 0);
    expect(gasProperties('Nitrogen', 300)!.R).toBeCloseTo(0.2968, 3);
  });
  it('interpolates cp and stays in range', () => {
    const a = gasCp('Air', 450)!;
    expect(a).toBeGreaterThan(gasCp('Air', 400)!);
    expect(a).toBeLessThan(gasCp('Air', 500)!);
    expect(gasCp('Air', 100)).toBeNull();
    expect(gasCp('Unobtainium', 300)).toBeNull();
    expect(gases().length).toBeGreaterThan(10);
  });
});

describe('materials', () => {
  it('lists standard values', () => {
    const al = MATERIALS.find((x) => x.id === 'al6061')!;
    expect([al.density, al.modulus, al.yield, al.conductivity]).toEqual([2700, 68.9, 276, 167]);
    expect(MATERIALS.find((x) => x.id === 'ss304')!.modulus).toBe(193);
  });
  it('cites every row to a listed source', () => {
    for (const one of MATERIALS) {
      expect(one.sources.length).toBeGreaterThan(0);
      for (const id of one.sources) expect(MATERIAL_SOURCES[id], `${one.id} ${id}`).toBeDefined();
    }
  });
  it('searches by every word', () => {
    expect(searchMaterials('6061').map((x) => x.id)).toEqual(['al6061']);
    expect(searchMaterials('stainless 316').map((x) => x.id)).toEqual(['ss316']);
    expect(searchMaterials('steel').length).toBeGreaterThan(3);
    expect(searchMaterials('zzz')).toEqual([]);
    expect(searchMaterials('').length).toBe(MATERIALS.length);
  });
});
