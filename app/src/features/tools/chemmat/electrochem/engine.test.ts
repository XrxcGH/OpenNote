import '../text';
import { describe, expect, it } from 'vitest';
import { cell, electrolysis, halfById, standardPotential } from './engine';
import { HALF_REACTIONS } from '../data/halfReactions';
import type { Outcome } from '../types';

const num = (o: Outcome, key: string): number => {
  if (!o.ok) throw new Error(o.key);
  const r = o.rows.find((x) => x.key === key);
  if (!r || typeof r.value !== 'number') throw new Error(`no ${key}`);
  return r.value;
};
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const E = (id: string) => standardPotential(halfById(id)!).E;

describe('standard potentials', () => {
  it('Cu2+/Cu, Zn2+/Zn, Ag+/Ag from formation Gibbs energies', () => {
    expect(Math.abs(E('Cu') - 0.3394)).toBeLessThan(5e-4);
    expect(Math.abs(E('Zn') - -0.7621)).toBeLessThan(5e-4);
    expect(Math.abs(E('Ag') - 0.7992)).toBeLessThan(5e-4);
  });

  it('hydrogen is zero by definition and the halogens, oxygen, and iron(III) are close to the tables', () => {
    expect(Math.abs(E('H'))).toBeLessThan(1e-9);
    expect(Math.abs(E('Cl2') - 1.358)).toBeLessThan(0.01);
    expect(Math.abs(E('I2') - 0.535)).toBeLessThan(0.01);
    expect(Math.abs(E('O2acid') - 1.229)).toBeLessThan(0.01);
    expect(Math.abs(E('O2base') - 0.401)).toBeLessThan(0.01);
    expect(Math.abs(E('Fe3') - 0.771)).toBeLessThan(0.01);
    expect(Math.abs(E('AgCl') - 0.222)).toBeLessThan(0.01);
  });

  it('every half-reaction has data for each species', () => {
    for (const h of HALF_REACTIONS) expect(Number.isFinite(E(h.id)), h.id).toBe(true);
  });
});

describe('cells', () => {
  it('Daniell cell with [Zn2+] 0.1 M and [Cu2+] 1e-3 M', () => {
    const o = cell({ a: 'Zn', b: 'Cu', concA: 'Zn2+ = 0.1', concB: 'Cu2+ = 0.001', T: 298.15 });
    expect(Math.abs(num(o, 'kitChemMat.ec.row.E0') - 1.1015)).toBeLessThan(1e-4);
    expect(Math.abs(num(o, 'kitChemMat.ec.row.E') - 1.0423)).toBeLessThan(1e-4);
    expect(rel(num(o, 'kitChemMat.ec.row.dG0'), -212550)).toBeLessThan(1e-4);
    // Independent Nernst: E = E0 - (RT/2F) ln([Zn2+]/[Cu2+]).
    const e = num(o, 'kitChemMat.ec.row.E0') - ((8.314462618 * 298.15) / (2 * 96485.33212)) * Math.log(100);
    expect(Math.abs(num(o, 'kitChemMat.ec.row.E') - e)).toBeLessThan(1e-12);
    expect(num(o, 'kitChemMat.ec.row.n')).toBe(2);
    if (!o.ok) throw new Error('x');
    expect(o.rows.find((r) => r.key === 'kitChemMat.ec.row.cathode')?.value).toContain('Cu2+');
  });

  it('the same two couples in either order give the same cell', () => {
    const one = cell({ a: 'Zn', b: 'Cu', concA: '', concB: '', T: 298.15 });
    const two = cell({ a: 'Cu', b: 'Zn', concA: '', concB: '', T: 298.15 });
    expect(num(one, 'kitChemMat.ec.row.E')).toBe(num(two, 'kitChemMat.ec.row.E'));
  });

  it('a concentration cell has zero standard potential and drives toward dilution', () => {
    const o = cell({ a: 'Cu', b: 'Cu', concA: 'Cu2+ = 1', concB: 'Cu2+ = 0.01', T: 298.15 });
    expect(Math.abs(num(o, 'kitChemMat.ec.row.E0'))).toBeLessThan(1e-12);
    // (RT/2F) ln 100 = 0.02955 V at 298.15 K.
    const expected = ((8.314462618 * 298.15) / (2 * 96485.33212)) * Math.log(100);
    expect(Math.abs(num(o, 'kitChemMat.ec.row.E') - expected)).toBeLessThan(1e-9);
  });

  it('different electron counts balance with the least common multiple', () => {
    const o = cell({ a: 'Al', b: 'Ag', concA: '', concB: '', T: 298.15 });
    expect(num(o, 'kitChemMat.ec.row.n')).toBe(3);
    const k = num(o, 'kitChemMat.ec.row.lnK');
    expect(rel(k, (3 * 96485.33212 * num(o, 'kitChemMat.ec.row.E0')) / (8.314462618 * 298.15))).toBeLessThan(1e-12);
  });

  it('rejects bad input', () => {
    expect(cell({ a: 'nope', b: 'Cu', concA: '', concB: '', T: 298.15 })).toMatchObject({ ok: false });
    expect(cell({ a: 'Zn', b: 'Cu', concA: 'Zn2+ = 0', concB: '', T: 298.15 })).toMatchObject({ ok: false });
    expect(cell({ a: 'Zn', b: 'Cu', concA: 'garbage', concB: '', T: 298.15 })).toMatchObject({ ok: false });
    expect(cell({ a: 'Zn', b: 'Cu', concA: '', concB: '', T: -1 })).toMatchObject({ ok: false });
  });
});

describe('electrolysis', () => {
  it('2.00 A for 1.00 h deposits 2.3710 g of copper', () => {
    const o = electrolysis({ product: 'Cu', find: 'mass', I: 2, t: 3600, m: 0, efficiency: 100 });
    expect(rel(num(o, 'kitChemMat.ec.row.mass'), 2.371)).toBeLessThan(1e-4);
    // Independent: mol = I t / (2 F); mass = mol * M.
    expect(rel(num(o, 'kitChemMat.ec.row.mass'), (7200 / (2 * 96485.33212)) * 63.546)).toBeLessThan(1e-4);
  });

  it('finds the time for a mass and honors current efficiency', () => {
    const o = electrolysis({ product: 'Ag', find: 'time', I: 0.5, t: 0, m: 1, efficiency: 80 });
    const t = (1 * 1 * 96485.33212) / (0.8 * 0.5 * 107.8682);
    expect(rel(num(o, 'kitChemMat.ec.row.time'), t)).toBeLessThan(1e-4);
  });

  it('rejects zero current, negative time, and impossible efficiency', () => {
    expect(electrolysis({ product: 'Cu', find: 'mass', I: 0, t: 10, m: 0, efficiency: 100 })).toMatchObject({
      ok: false,
    });
    expect(electrolysis({ product: 'Cu', find: 'mass', I: 1, t: -10, m: 0, efficiency: 100 })).toMatchObject({
      ok: false,
    });
    expect(electrolysis({ product: 'Cu', find: 'mass', I: 1, t: 10, m: 0, efficiency: 120 })).toMatchObject({
      ok: false,
    });
    expect(electrolysis({ product: 'Cu', find: 'time', I: 1, t: 0, m: 0, efficiency: 100 })).toMatchObject({
      ok: false,
    });
    expect(electrolysis({ product: 'xx', find: 'mass', I: 1, t: 10, m: 0, efficiency: 100 })).toMatchObject({
      ok: false,
    });
  });

  it('zero time gives zero mass', () => {
    expect(
      num(electrolysis({ product: 'Cu', find: 'mass', I: 1, t: 0, m: 0, efficiency: 100 }), 'kitChemMat.ec.row.mass'),
    ).toBe(0);
  });
});
