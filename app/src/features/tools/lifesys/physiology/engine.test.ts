// Physiology against the planning pass's independent values (computed separately in Python), textbook closed forms,
// and the documented errors.
import { describe, expect, it } from 'vitest';
import { LsError } from '../num/errors';
import {
  acidBaseResult,
  alveolarO2,
  cardiacOutputResult,
  classify,
  clearance,
  contentResult,
  dissociationResult,
  ejectionResult,
  fena,
  infuse,
  lmsX,
  lmsZ,
  macroResult,
  meanArterial,
  mifflin,
  phFrom,
  poiseuille,
  reabsorbed,
  resistanceResult,
  severinghaus,
  soluteMpa,
  starlingResult,
  ventilationResult,
  virtualPo2,
} from './engine';

const value = (r: { rows: { label: string; value: number | string }[] }, label: string) =>
  r.rows.find((x) => x.label === `physiology.r.${label}`)?.value as number;
const throwsKey = (fn: () => unknown, key: string) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(LsError);
    expect((e as LsError).key).toBe(key);
    return;
  }
  throw new Error(`expected ${key}`);
};

describe('respiratory', () => {
  it('gives PAO2 99.73 mmHg on room air at sea level', () => {
    expect(alveolarO2(0.21, 760, 47, 40, 0.8)).toBeCloseTo(99.73, 6);
  });

  it('gives O2 content 19.998 mL/dL and Severinghaus saturations 0.749465 and 0.977465', () => {
    expect(value(contentResult(15, 0.98, 100, null), 'cao2')).toBeCloseTo(19.998, 6);
    expect(severinghaus(40)).toBeCloseTo(0.749465, 6);
    expect(severinghaus(100)).toBeCloseTo(0.977465, 6);
  });

  it('shifts the curve right with acid and heat', () => {
    expect(virtualPo2(40, 7.4, 40, 37)).toBeCloseTo(40, 12);
    const acid = dissociationResult(40, 7.2, 40, 37);
    const std = dissociationResult(40, 7.4, 40, 37);
    expect(value(acid, 'p50')).toBeGreaterThan(value(std, 'p50'));
    expect(value(std, 'p50')).toBeCloseTo(26.86, 1);
  });

  it('gives alveolar ventilation and the Bohr dead space', () => {
    const r = ventilationResult(500, 12, null, 40, 28);
    expect(value(r, 'vdvt')).toBeCloseTo(0.3, 12);
    expect(value(r, 'va')).toBeCloseTo(4.2, 12);
    throwsKey(() => ventilationResult(500, 12, 600, null, null), 'physiology.e.deadSpace');
  });
});

describe('cardiovascular', () => {
  it('gives cardiac output both ways', () => {
    expect(value(cardiacOutputResult('hrsv', 70, 70, 0, 0, 0), 'co')).toBeCloseTo(4.9, 12);
    expect(value(cardiacOutputResult('fick', 0, 0, 250, 20, 15), 'co')).toBeCloseTo(5, 12);
    throwsKey(() => cardiacOutputResult('fick', 0, 0, 250, 15, 20), 'physiology.e.avDiff');
  });

  it('gives MAP, EF, and resistances', () => {
    expect(meanArterial(120, 80)).toBeCloseTo(93.3333, 4);
    expect(value(ejectionResult(120, 50, null), 'ef')).toBeCloseTo(58.3333, 4);
    const series = resistanceResult('series', { dp: 0, q: 0, list: [2, 3, 6], eta: 0, length: 0, radius: 0 });
    const parallel = resistanceResult('parallel', { dp: 0, q: 0, list: [2, 3, 6], eta: 0, length: 0, radius: 0 });
    expect(value(series, 'total')).toBe(11);
    expect(value(parallel, 'total')).toBeCloseTo(1, 12);
  });

  it('scales Poiseuille resistance by r⁻⁴', () => {
    expect(poiseuille(3.5, 1, 0.005) / poiseuille(3.5, 1, 0.01)).toBeCloseTo(16, 9);
  });
});

describe('renal and acid-base', () => {
  it('gives inulin clearance 120 mL/min and FENa 0.28571%', () => {
    expect(clearance(30, 1, 0.25)).toBeCloseTo(120, 9);
    expect(fena(40, 140, 100, 1)).toBeCloseTo(0.28571, 5);
  });

  it('gives pH 7.40103 for HCO3 24 and PCO2 40, and Winter’s 26 ± 2 for HCO3 12', () => {
    expect(phFrom(24, 40)).toBeCloseTo(7.40103, 5);
    const c = classify(phFrom(12, 26), 26, 12, false);
    expect(c.disorder).toBe('metAcidosis');
    expect(c.expected![0]).toBeCloseTo(24, 12);
    expect(c.expected![1]).toBeCloseTo(28, 12);
  });

  it('calls a normal pH with low HCO3 and low PCO2 a mixed disorder', () => {
    // HCO3 15 and PCO2 25: pH = 6.1 + log10(15 / 0.75) = 7.4010, a metabolic acidosis offset by a respiratory alkalosis.
    expect(classify(phFrom(15, 25), 25, 15, false).disorder).toBe('mixed');
    const r = acidBaseResult(15, 25, false, null, null, null);
    expect(r.rows[1].word).toBe('physiology.o.mixed');
    expect(r.notes!.map((n) => n.key)).toContain('physiology.n.mixed');
    expect(classify(phFrom(24, 40), 40, 24, false).disorder).toBe('normal');
  });

  it('classifies respiratory disorders and computes the anion gap', () => {
    expect(classify(phFrom(26, 60), 60, 26, false).disorder).toBe('respAcidosis');
    expect(classify(phFrom(22, 25), 25, 22, false).disorder).toBe('respAlkalosis');
    const r = acidBaseResult(12, 26, false, 140, 104, null);
    expect(value(r, 'anionGap')).toBe(24);
    expect(value(r, 'delta')).toBeCloseTo(1, 12);
  });

  it('saturates reabsorption at Tm', () => {
    expect(reabsorbed(100, 375, 1)).toBe(100);
    expect(reabsorbed(1000, 375, 1)).toBe(375);
    expect(reabsorbed(1000, 375, 0.98)).toBeLessThan(375);
    expect(reabsorbed(1e6, 375, 0.9)).toBeCloseTo(375, 0);
  });
});

describe('fluids and energy', () => {
  it('leaves cells unchanged after isotonic saline and swells them after water', () => {
    const iso = infuse(70, 0.6, 290, 1, 290);
    expect(iso.after.icf).toBeCloseTo(iso.before.icf, 9);
    expect(iso.after.ecf).toBeCloseTo(iso.before.ecf + 1, 9);
    const water = infuse(70, 0.6, 290, 1, 0);
    expect(water.after.icf - water.before.icf).toBeCloseTo((2 / 3) * 1, 9);
  });

  it('gives Starling filtration and its direction', () => {
    const r = starlingResult(32, 1, 25, 3, 0.9, 1);
    expect(value(r, 'netPressure')).toBeCloseTo(11.2, 12);
  });

  it('gives a BMR of 1673.75 kcal/day for a 25-year-old male, 70 kg, 175 cm', () => {
    expect(mifflin('male', 70, 175, 25)).toBeCloseTo(1673.75, 9);
    expect(mifflin('female', 70, 175, 25)).toBeCloseTo(1507.75, 9);
  });

  it('adds macronutrient energy by Atwater factors', () => {
    expect(value(macroResult(100, 50, 20, 0), 'energy')).toBe(780);
    throwsKey(() => macroResult(0, 0, 0, 0), 'physiology.e.noFood');
  });
});

describe('growth and plants', () => {
  it('gives z = 1.20188 for X 20, L −1.5, M 17, S 0.12, and inverts it', () => {
    const z = lmsZ(20, -1.5, 17, 0.12);
    expect(z).toBeCloseTo(1.20188, 5);
    expect(lmsX(z, -1.5, 17, 0.12)).toBeCloseTo(20, 9);
    expect(lmsZ(17, 0, 17, 0.1)).toBe(0);
  });

  it('gives −0.245277 MPa for 0.1 M sucrose at 295 K', () => {
    expect(soluteMpa(1, 0.1, 295 - 273.15)).toBeCloseTo(-0.245277, 6);
  });
});
