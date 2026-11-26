import '../text';
import { describe, expect, it } from 'vitest';
import { parseReaction, reactionQuantities, thermochem } from './engine';
import { SPECIES, gibbsOfFormation } from '../data/species';
import { parseFormula } from '../../chem/calc/formula';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const get = (text: string, T = 298.15) => {
  const p = parseReaction(text);
  if (!p.ok) throw new Error('parse');
  return reactionQuantities(p.value, T);
};

describe('thermochemistry', () => {
  it('ammonia synthesis at 298.15 K', () => {
    const q = get('N2(g) + 3 H2(g) -> 2 NH3(g)');
    expect(rel(q.dH, -91880)).toBeLessThan(1e-3);
    expect(rel(q.dS, -198.11)).toBeLessThan(1e-3);
    expect(rel(q.dG298, -32810)).toBeLessThan(1e-3);
    expect(rel(q.K298, 5.61e5)).toBeLessThan(1e-3 * 5);
    expect(rel(q.crossover ?? 0, 463.8)).toBeLessThan(1e-3);
    // Independent calculation of K from the three numbers by hand.
    const dG = -91880 - 298.15 * (2 * 192.77 - 191.609 - 3 * 130.68);
    expect(rel(q.K298, Math.exp(-dG / (8.314462618 * 298.15)))).toBeLessThan(1e-12);
  });

  it('the same reaction at 500 K with constant dH and dS', () => {
    const q = get('N2(g) + 3 H2(g) -> 2 NH3(g)', 500);
    expect(rel(q.KT, 0.17803)).toBeLessThan(1e-3);
    // The van 't Hoff form gives the same K from K at 298.15 K.
    const vh = q.K298 * Math.exp((-q.dH / 8.314462618) * (1 / 500 - 1 / 298.15));
    expect(rel(q.KT, vh)).toBeLessThan(1e-9);
  });

  it('methane combustion to liquid water', () => {
    const q = get('CH4(g) + 2 O2(g) -> CO2(g) + 2 H2O(l)');
    expect(rel(q.dH, -890310)).toBeLessThan(1e-4);
    // Hess: the same total from the gas-phase route plus condensation.
    const viaGas = get('CH4(g) + 2 O2(g) -> CO2(g) + 2 H2O(g)').dH + 2 * get('H2O(g) -> H2O(l)').dH;
    expect(rel(q.dH, viaGas)).toBeLessThan(1e-12);
  });

  it('defaults a missing phase to the first listed (liquid water) and reads ions without splitting charges', () => {
    const p = parseReaction('Zn(s) + Cu2+(aq) -> Zn2+(aq) + Cu(s)');
    expect(p.ok).toBe(true);
    const q = get('Zn(s) + Cu2+(aq) -> Zn2+(aq) + Cu(s)');
    expect(rel(q.dH, -218660)).toBeLessThan(1e-3);
    const w = parseReaction('H2(g) + 0.5 O2(g) -> H2O');
    expect(w.ok && w.value.products[0].species.phase).toBe('l');
  });

  it('reports an unbalanced reaction with the balanced one as a hint', () => {
    const r = thermochem({ equation: 'N2(g) + H2(g) -> NH3(g)', T: 298.15 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.key).toBe('kitChemMat.thermo.err.unbalancedHint');
      expect(r.vars?.hint).toContain('2');
    }
  });

  it('rejects unknown species, bad format, and impossible temperatures', () => {
    expect(thermochem({ equation: 'XeF6(g) -> Xe(g)', T: 298.15 })).toMatchObject({ ok: false });
    expect(thermochem({ equation: 'nonsense', T: 298.15 })).toMatchObject({ ok: false });
    expect(thermochem({ equation: 'N2(g) -> N2(g)', T: 0 })).toMatchObject({ ok: false });
    expect(thermochem({ equation: 'N2(g) -> N2(g)', T: -5 })).toMatchObject({ ok: false });
  });

  it('a reaction with no net change has dG = 0, K = 1, and no crossover', () => {
    const r = thermochem({ equation: 'N2(g) -> N2(g)', T: 298.15 });
    expect(r.ok).toBe(true);
    const q = get('N2(g) -> N2(g)');
    expect(q.dG298).toBe(0);
    expect(q.K298).toBe(1);
    expect(q.crossover).toBeNull();
  });

  it('survives a huge or tiny K without NaN', () => {
    const q = get('H2(g) + 0.5 O2(g) -> H2O(l)', 20);
    expect(Number.isFinite(q.lnKT)).toBe(true);
    expect(q.KT).toBe(Infinity);
    expect(get('N2(g) + 3 H2(g) -> 2 NH3(g)', 2000).KT).toBeGreaterThan(0);
    expect(q.lnKT).toBeGreaterThan(700);
  });

  it('every species has a formula the parser reads and a Gibbs energy that agrees with H - TS for neutral species', () => {
    for (const s of SPECIES) {
      expect(parseFormula(s.formula), s.formula).not.toBeNull();
      if (s.phase !== 'aq' && s.gf !== undefined) {
        const counts = parseFormula(s.formula)!;
        const computed = gibbsOfFormation({ ...s, gf: undefined }, counts);
        if (computed !== null) expect(Math.abs(computed - s.gf), s.formula).toBeLessThan(0.3);
      }
    }
  });
});
