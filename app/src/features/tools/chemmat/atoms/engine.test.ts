import { describe, expect, it } from 'vitest';
import {
  box,
  boxEnergy,
  deBroglie,
  hydrogen,
  levelEnergy,
  lineWavelength,
  photon,
  quantum,
  spectrumRegion,
} from './engine';
import {
  bondType,
  element,
  fillOrbitals,
  findElement,
  formalCharge,
  molecularOrbitals,
  valenceElectrons,
  vsepr,
} from './bonding';
import { ELEMENTS } from '../../reference/data';
import type { Outcome } from '../types';

const val = (o: Outcome, key: string): number => {
  if (!o.ok) throw new Error(o.key);
  const r = o.rows.find((x) => x.key === key);
  if (!r || typeof r.value !== 'number') throw new Error(`no ${key}`);
  return r.value;
};
const word = (o: Outcome, key: string): string | undefined =>
  o.ok ? o.rows.find((x) => x.key === key)?.word : undefined;
const str = (o: Outcome, key: string): string => {
  if (!o.ok) throw new Error(o.key);
  return String(o.rows.find((x) => x.key === key)?.value);
};
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const EV = 1.602176634e-19;

describe('photons', () => {
  it('500 nm: 3.9729e-19 J and 2.4797 eV', () => {
    const o = photon({ from: 'wavelength', lambda: 500e-9, nu: NaN, energy: NaN });
    expect(rel(val(o, 'kitChemMat.at.row.energyJ'), 3.9729e-19)).toBeLessThan(1e-4);
    expect(rel(val(o, 'kitChemMat.at.row.photonEnergy') / EV, 2.4797)).toBeLessThan(1e-4);
    // independent: E = h c / lambda
    expect(rel(val(o, 'kitChemMat.at.row.energyJ'), (6.62607015e-34 * 299792458) / 500e-9)).toBeLessThan(1e-12);
    expect(rel(val(o, 'kitChemMat.at.row.frequency'), 5.99584916e14)).toBeLessThan(1e-8);
    expect(rel(val(o, 'kitChemMat.at.row.perMole'), 239.27)).toBeLessThan(1e-3);
    expect(rel(val(o, 'kitChemMat.at.row.wavenumber'), 20000)).toBeLessThan(1e-12);
    expect(word(o, 'kitChemMat.at.row.region')).toBe('kitChemMat.at.region.visible');
  });

  it('the three starting quantities agree with each other', () => {
    const a = photon({ from: 'wavelength', lambda: 500e-9, nu: NaN, energy: NaN });
    const b = photon({ from: 'frequency', lambda: NaN, nu: val(a, 'kitChemMat.at.row.frequency'), energy: NaN });
    const c = photon({ from: 'energy', lambda: NaN, nu: NaN, energy: val(a, 'kitChemMat.at.row.energyJ') });
    expect(rel(val(b, 'kitChemMat.at.row.wavelength'), 500e-9)).toBeLessThan(1e-12);
    expect(rel(val(c, 'kitChemMat.at.row.wavelength'), 500e-9)).toBeLessThan(1e-12);
  });

  it('regions: X-ray, ultraviolet, infrared, microwave, radio', () => {
    expect(spectrumRegion(1e-10)).toBe('kitChemMat.at.region.xray');
    expect(spectrumRegion(250e-9)).toBe('kitChemMat.at.region.uv');
    expect(spectrumRegion(10e-6)).toBe('kitChemMat.at.region.infrared');
    expect(spectrumRegion(0.03)).toBe('kitChemMat.at.region.microwave');
    expect(spectrumRegion(100)).toBe('kitChemMat.at.region.radio');
    expect(spectrumRegion(1e-12)).toBe('kitChemMat.at.region.gamma');
  });

  it('refuses zero and negative values', () => {
    expect(photon({ from: 'wavelength', lambda: 0, nu: NaN, energy: NaN })).toMatchObject({
      key: 'kitChemMat.at.err.wavelength',
    });
    expect(photon({ from: 'frequency', lambda: NaN, nu: -1, energy: NaN })).toMatchObject({
      key: 'kitChemMat.at.err.frequency',
    });
    expect(photon({ from: 'energy', lambda: NaN, nu: NaN, energy: 0 })).toMatchObject({
      key: 'kitChemMat.at.err.energy',
    });
  });
});

describe('hydrogen atom', () => {
  it('n = 3 to 2 is 656.47 nm in vacuum', () => {
    const o = hydrogen({ Z: 1, nLow: 2, nHigh: 3 });
    expect(rel(val(o, 'kitChemMat.at.row.wavelength') * 1e9, 656.47)).toBeLessThan(1e-4);
    // independent: 1 / lambda = R_H (1/4 - 1/9)
    expect(rel(val(o, 'kitChemMat.at.row.wavelength'), 1 / (1.09677583e7 * (1 / 4 - 1 / 9)))).toBeLessThan(1e-7);
    expect(word(o, 'kitChemMat.at.row.series')).toBe('kitChemMat.at.series.balmer');
    expect(word(o, 'kitChemMat.at.row.region')).toBe('kitChemMat.at.region.visible');
  });

  it('Lyman alpha 121.5 nm, the Balmer limit near 364.7 nm, and the ionization energy 13.598 eV', () => {
    expect(Math.abs(lineWavelength(1, 1, 2) * 1e9 - 121.5)).toBeLessThan(0.1);
    expect(Math.abs(lineWavelength(1, 2, 1e9) * 1e9 - 364.7)).toBeLessThan(0.1);
    const o = hydrogen({ Z: 1, nLow: 1, nHigh: 2 });
    expect(Math.abs(val(o, 'kitChemMat.at.row.ionization') / EV - 13.598)).toBeLessThan(1e-3);
    expect(word(o, 'kitChemMat.at.row.region')).toBe('kitChemMat.at.region.uv');
  });

  it('the line energy is the difference of the two level energies, and the order of the levels does not matter', () => {
    const a = hydrogen({ Z: 1, nLow: 2, nHigh: 5 });
    const b = hydrogen({ Z: 1, nLow: 5, nHigh: 2 });
    expect(val(a, 'kitChemMat.at.row.photonEnergy')).toBeCloseTo(val(b, 'kitChemMat.at.row.photonEnergy'), 30);
    expect(rel(val(a, 'kitChemMat.at.row.photonEnergy'), levelEnergy(1, 5) - levelEnergy(1, 2))).toBeLessThan(1e-12);
  });

  it('a one-electron ion scales as Z squared', () => {
    expect(rel(levelEnergy(2, 1), 4 * levelEnergy(1, 1))).toBeLessThan(1e-14);
    expect(rel(lineWavelength(3, 1, 2), lineWavelength(1, 1, 2) / 9)).toBeLessThan(1e-14);
  });

  it('refuses equal levels, zero, fractions and a bad charge', () => {
    expect(hydrogen({ Z: 1, nLow: 2, nHigh: 2 })).toMatchObject({ key: 'kitChemMat.at.err.sameLevel' });
    expect(hydrogen({ Z: 1, nLow: 0, nHigh: 2 })).toMatchObject({ key: 'kitChemMat.at.err.level' });
    expect(hydrogen({ Z: 1, nLow: 2.5, nHigh: 3 })).toMatchObject({ key: 'kitChemMat.at.err.level' });
    expect(hydrogen({ Z: 0, nLow: 1, nHigh: 2 })).toMatchObject({ key: 'kitChemMat.at.err.charge' });
  });
});

describe('one bonded atom (HF, HCl, H2)', () => {
  it.each([0, 1, 2, 3])('has a linear diatomic shape with %i lone pairs', (e) => {
    expect(vsepr(1, e, true).ok).toBe(true);
  });
});

describe('de Broglie wavelength', () => {
  it('an electron of 100 eV: 0.12264 nm', () => {
    const o = deBroglie({ particle: 'electron', customMass: NaN, given: 'energy', speed: NaN, energy: 100 * EV });
    expect(rel(val(o, 'kitChemMat.at.row.lambdaDB') * 1e9, 0.12264)).toBeLessThan(1e-4);
    // independent: lambda = h / sqrt(2 m K)
    expect(
      rel(val(o, 'kitChemMat.at.row.lambdaDB'), 6.62607015e-34 / Math.sqrt(2 * 9.1093837139e-31 * 100 * EV)),
    ).toBeLessThan(1e-4);
  });

  it('a 200 keV electron is 2.5079 pm relativistically, 2.742 pm nonrelativistically (microscope case)', () => {
    const o = deBroglie({ particle: 'electron', customMass: NaN, given: 'energy', speed: NaN, energy: 200e3 * EV });
    expect(rel(val(o, 'kitChemMat.at.row.lambdaDB') * 1e12, 2.5079)).toBeLessThan(2e-4);
    expect(rel(val(o, 'kitChemMat.at.row.lambdaNR') * 1e12, 2.742)).toBeLessThan(1e-3);
    // independent: lambda = h c / sqrt(K (K + 2 m c^2)), and v = 0.6953 c
    const K = 200e3 * EV;
    const mc2 = 9.1093837139e-31 * 299792458 ** 2;
    expect(rel(val(o, 'kitChemMat.at.row.lambdaDB'), (6.62607015e-34 * 299792458) / Math.sqrt(K * (K + 2 * mc2)))).toBeLessThan(
      1e-12,
    );
    expect(rel(val(o, 'kitChemMat.at.row.speed') / 299792458, 0.6953)).toBeLessThan(1e-3);
  });

  it('a 150 g ball at 40 m/s has a wavelength near 1.1e-34 m', () => {
    const o = deBroglie({ particle: 'custom', customMass: 150, given: 'speed', speed: 40, energy: NaN });
    expect(rel(val(o, 'kitChemMat.at.row.lambdaDB'), 6.62607015e-34 / (0.15 * 40))).toBeLessThan(1e-9);
    expect(rel(val(o, 'kitChemMat.at.row.kinetic'), 0.5 * 0.15 * 1600)).toBeLessThan(1e-9);
  });

  it('speed and energy give consistent answers, and a heavier particle has a shorter wavelength', () => {
    const e = deBroglie({ particle: 'electron', customMass: NaN, given: 'energy', speed: NaN, energy: 50 * EV });
    const v = val(e, 'kitChemMat.at.row.speed');
    const back = deBroglie({ particle: 'electron', customMass: NaN, given: 'speed', speed: v, energy: NaN });
    expect(rel(val(back, 'kitChemMat.at.row.lambdaDB'), val(e, 'kitChemMat.at.row.lambdaDB'))).toBeLessThan(1e-12);
    const p = deBroglie({ particle: 'proton', customMass: NaN, given: 'speed', speed: v, energy: NaN });
    expect(rel(val(p, 'kitChemMat.at.row.lambdaDB') * 1836.15267, val(e, 'kitChemMat.at.row.lambdaDB'))).toBeLessThan(
      1e-4,
    );
  });

  it('warns for fast particles and refuses light speed, zero mass and negative energy', () => {
    const fast = deBroglie({ particle: 'electron', customMass: NaN, given: 'speed', speed: 1e8, energy: NaN });
    expect(fast.ok && fast.notes.some((n) => n.key === 'kitChemMat.at.note.fast')).toBe(true);
    expect(deBroglie({ particle: 'electron', customMass: NaN, given: 'speed', speed: 3e8, energy: NaN })).toMatchObject(
      {
        key: 'kitChemMat.at.err.light',
      },
    );
    expect(deBroglie({ particle: 'custom', customMass: 0, given: 'speed', speed: 5, energy: NaN })).toMatchObject({
      key: 'kitChemMat.at.err.mass',
    });
    expect(deBroglie({ particle: 'electron', customMass: NaN, given: 'energy', speed: NaN, energy: -1 })).toMatchObject(
      {
        key: 'kitChemMat.at.err.kinetic',
      },
    );
  });
});

describe('particle in a box', () => {
  const base = { particle: 'electron', customMass: NaN, L: 1e-9, n: 1, m: NaN };

  it('an electron in a 1 nm box, n = 1: 0.37603 eV', () => {
    const o = box(base);
    expect(rel(val(o, 'kitChemMat.at.row.boxEnergy') / EV, 0.37603)).toBeLessThan(1e-4);
    expect(
      rel(boxEnergy(9.1093837139e-31, 1e-9, 1), 6.62607015e-34 ** 2 / (8 * 9.1093837139e-31 * 1e-18)),
    ).toBeLessThan(1e-12);
  });

  it('levels grow as n squared, and the transition wavelength follows from the gap', () => {
    const o = box({ ...base, n: 1, m: 2 });
    expect(rel(val(o, 'kitChemMat.at.row.boxGap') / EV, 3 * 0.37603)).toBeLessThan(1e-4);
    expect(
      rel(val(o, 'kitChemMat.at.row.wavelength'), (6.62607015e-34 * 299792458) / val(o, 'kitChemMat.at.row.boxGap')),
    ).toBeLessThan(1e-12);
    expect(rel(boxEnergy(9.1093837139e-31, 1e-9, 4), 16 * boxEnergy(9.1093837139e-31, 1e-9, 1))).toBeLessThan(1e-14);
  });

  it('a wider box lowers the energy as 1 / L squared', () => {
    const wide = val(box({ ...base, L: 2e-9 }), 'kitChemMat.at.row.boxEnergy');
    expect(rel(wide, val(box(base), 'kitChemMat.at.row.boxEnergy') / 4)).toBeLessThan(1e-12);
  });

  it('refuses n = 0, fractional n, equal levels, and zero length', () => {
    expect(box({ ...base, n: 0 })).toMatchObject({ key: 'kitChemMat.at.err.quantum' });
    expect(box({ ...base, n: 1.5 })).toMatchObject({ key: 'kitChemMat.at.err.quantum' });
    expect(box({ ...base, m: 1 })).toMatchObject({ key: 'kitChemMat.at.err.sameLevel' });
    expect(box({ ...base, L: 0 })).toMatchObject({ key: 'kitChemMat.at.err.length' });
  });
});

describe('quantum numbers', () => {
  it('n = 3 has 3 subshells, 9 orbitals and 18 electrons', () => {
    const o = quantum({ n: 3, l: NaN, ml: NaN, ms: NaN });
    expect(str(o, 'kitChemMat.at.row.subshells')).toBe('3');
    expect(str(o, 'kitChemMat.at.row.orbitals')).toBe('9');
    expect(str(o, 'kitChemMat.at.row.maxElectrons')).toBe('18');
    expect(o.ok && o.tables![0].rows.map((r) => r[0])).toEqual(['3s', '3p', '3d']);
    expect(o.ok && o.tables![0].rows.map((r) => r[3])).toEqual(['1', '3', '5']);
  });

  it('the electrons in all subshells add to 2 n squared', () => {
    for (let n = 1; n <= 7; n++) {
      const o = quantum({ n, l: NaN, ml: NaN, ms: NaN });
      const total = o.ok ? o.tables![0].rows.reduce((s, r) => s + Number(r[4]), 0) : 0;
      expect(total).toBe(2 * n * n);
    }
  });

  it('accepts a valid set and names its subshell', () => {
    const o = quantum({ n: 3, l: 2, ml: -2, ms: 0.5 });
    expect(str(o, 'kitChemMat.at.row.subshell')).toBe('3d');
    expect(word(o, 'kitChemMat.at.row.orbitalOk')).toBe('kitChemMat.at.word.allowed');
    expect(word(o, 'kitChemMat.at.row.spin')).toBe('kitChemMat.at.word.up');
  });

  it('explains each rule that a set breaks', () => {
    expect(quantum({ n: 3, l: 3, ml: NaN, ms: NaN })).toMatchObject({
      key: 'kitChemMat.at.err.azimuthalLarge',
      vars: { n: '3', max: '2' },
    });
    expect(quantum({ n: 2, l: 1, ml: 2, ms: NaN })).toMatchObject({
      key: 'kitChemMat.at.err.magneticLarge',
      vars: { l: '1' },
    });
    expect(quantum({ n: 2, l: 1, ml: 0, ms: 0.3 })).toMatchObject({ key: 'kitChemMat.at.err.spin' });
    expect(quantum({ n: 0, l: NaN, ml: NaN, ms: NaN })).toMatchObject({ key: 'kitChemMat.at.err.principal' });
    expect(quantum({ n: 2, l: -1, ml: NaN, ms: NaN })).toMatchObject({ key: 'kitChemMat.at.err.azimuthal' });
  });
});

describe('elements and bond type', () => {
  it('finds an element by symbol, name or number', () => {
    expect(findElement('fe')?.number).toBe(26);
    expect(findElement('Iron')?.symbol).toBe('Fe');
    expect(findElement('17')?.symbol).toBe('Cl');
    expect(findElement('Xx')).toBeNull();
    expect(findElement('')).toBeNull();
  });

  it('iron: configuration from the reference data, period 4, group 8', () => {
    const o = element('Fe', '');
    expect(str(o, 'kitChemMat.at.row.configuration')).toBe('[Ar] 3d⁶ 4s²');
    expect(str(o, 'kitChemMat.at.row.period')).toBe('4');
    expect(str(o, 'kitChemMat.at.row.group')).toBe('8');
    expect(str(o, 'kitChemMat.at.row.valence')).toBe('8');
  });

  it('valence electrons follow the group', () => {
    const v = (s: string) => valenceElectrons(findElement(s)!);
    expect([v('H'), v('He'), v('Na'), v('Al'), v('C'), v('N'), v('O'), v('Cl'), v('Ar')]).toEqual([
      1, 2, 1, 3, 4, 5, 6, 7, 8,
    ]);
    expect(v('Ce')).toBeNull();
  });

  it('sodium chloride is ionic and carbon-hydrogen is nonpolar by the usual cutoffs', () => {
    const na = ELEMENTS.find((e) => e.symbol === 'Na')!.electronegativity!;
    const cl = ELEMENTS.find((e) => e.symbol === 'Cl')!.electronegativity!;
    const o = element('Na', 'Cl');
    expect(val(o, 'kitChemMat.at.row.deltaEn')).toBeCloseTo(Math.abs(na - cl), 12);
    expect(word(o, 'kitChemMat.at.row.bondType')).toBe('kitChemMat.at.bond.ionic');
    expect(bondType(0.35)).toBe('kitChemMat.at.bond.nonpolar');
    expect(bondType(0.9)).toBe('kitChemMat.at.bond.polar');
    expect(bondType(1.7)).toBe('kitChemMat.at.bond.ionic');
  });

  it('refuses an unknown element, and a noble gas without electronegativity', () => {
    expect(element('Qq', '')).toMatchObject({ key: 'kitChemMat.at.err.element', vars: { text: 'Qq' } });
    expect(element('Na', 'Zz')).toMatchObject({ key: 'kitChemMat.at.err.element' });
    expect(element('He', 'Na')).toMatchObject({ key: 'kitChemMat.at.err.noEn' });
  });
});

describe('formal charge', () => {
  it('ammonium nitrogen +1, hydronium oxygen +1, carbonyl oxygen 0, single-bonded oxide -1', () => {
    expect(str(formalCharge(5, 0, 8), 'kitChemMat.at.row.formal')).toBe('+1');
    expect(str(formalCharge(6, 2, 6), 'kitChemMat.at.row.formal')).toBe('+1');
    expect(str(formalCharge(6, 4, 4), 'kitChemMat.at.row.formal')).toBe('0');
    expect(str(formalCharge(6, 6, 2), 'kitChemMat.at.row.formal')).toBe('-1');
  });

  it('refuses odd electron counts and impossible values', () => {
    expect(formalCharge(5, 0, 7)).toMatchObject({ key: 'kitChemMat.at.err.bonding' });
    expect(formalCharge(5, 3, 4)).toMatchObject({ key: 'kitChemMat.at.err.nonbondingOdd' });
    expect(formalCharge(9, 0, 4)).toMatchObject({ key: 'kitChemMat.at.err.valence' });
    expect(formalCharge(5, -2, 4)).toMatchObject({ key: 'kitChemMat.at.err.nonbonding' });
  });
});

describe('VSEPR', () => {
  const shape = (x: number, e: number) => {
    const o = vsepr(x, e, true);
    return {
      geometry: word(o, 'kitChemMat.at.row.geometry'),
      shape: word(o, 'kitChemMat.at.row.shape'),
      angles: word(o, 'kitChemMat.at.row.angles'),
    };
  };

  it('AX4 tetrahedral at 109.5, AX3E trigonal pyramidal, AX2E2 bent, AX4E2 square planar', () => {
    expect(shape(4, 0)).toEqual({
      geometry: 'kitChemMat.at.geom.tetrahedral',
      shape: 'kitChemMat.at.shape.tetrahedral',
      angles: 'kitChemMat.at.angle.a1095',
    });
    expect(shape(3, 1).shape).toBe('kitChemMat.at.shape.trigonalPyramidal');
    expect(shape(2, 2).shape).toBe('kitChemMat.at.shape.bent');
    expect(shape(4, 2).shape).toBe('kitChemMat.at.shape.squarePlanar');
    expect(shape(4, 2).geometry).toBe('kitChemMat.at.geom.octahedral');
  });

  it('the other classes from linear to octahedral', () => {
    expect(shape(2, 0).shape).toBe('kitChemMat.at.shape.linear');
    expect(shape(3, 0).shape).toBe('kitChemMat.at.shape.trigonalPlanar');
    expect(shape(2, 1).shape).toBe('kitChemMat.at.shape.bent');
    expect(shape(5, 0).shape).toBe('kitChemMat.at.shape.trigonalBipyramidal');
    expect(shape(4, 1).shape).toBe('kitChemMat.at.shape.seesaw');
    expect(shape(3, 2).shape).toBe('kitChemMat.at.shape.tShaped');
    expect(shape(2, 3).shape).toBe('kitChemMat.at.shape.linear');
    expect(shape(6, 0).shape).toBe('kitChemMat.at.shape.octahedral');
    expect(shape(5, 1).shape).toBe('kitChemMat.at.shape.squarePyramidal');
  });

  it('hybridization follows the number of domains', () => {
    const h = (x: number, e: number) => str(vsepr(x, e, true), 'kitChemMat.at.row.hybrid');
    expect([h(2, 0), h(3, 0), h(2, 1), h(4, 0), h(3, 1), h(5, 0), h(6, 0), h(4, 2)]).toEqual([
      'sp',
      'sp²',
      'sp²',
      'sp³',
      'sp³',
      'sp³d',
      'sp³d²',
      'sp³d²',
    ]);
  });

  it('identical terminal atoms cancel in the symmetric shapes only', () => {
    expect(word(vsepr(4, 0, true), 'kitChemMat.at.row.polarity')).toBe('kitChemMat.at.word.cancel');
    expect(word(vsepr(4, 0, false), 'kitChemMat.at.row.polarity')).toBe('kitChemMat.at.word.polarShape');
    expect(word(vsepr(3, 1, true), 'kitChemMat.at.row.polarity')).toBe('kitChemMat.at.word.polarShape');
    expect(word(vsepr(2, 2, true), 'kitChemMat.at.row.polarity')).toBe('kitChemMat.at.word.polarShape');
    expect(word(vsepr(4, 2, true), 'kitChemMat.at.row.polarity')).toBe('kitChemMat.at.word.cancel');
  });

  it('refuses classes that do not exist', () => {
    expect(vsepr(0, 2, true)).toMatchObject({ key: 'kitChemMat.at.err.bonded' });
    expect(vsepr(7, 0, true)).toMatchObject({ key: 'kitChemMat.at.err.bonded' });
    expect(vsepr(5, 2, true)).toMatchObject({ key: 'kitChemMat.at.err.domains' });
    expect(vsepr(3, 3, true)).toMatchObject({ key: 'kitChemMat.at.err.unknownShape', vars: { x: '3', e: '3' } });
    expect(vsepr(2, 1.5, true)).toMatchObject({ key: 'kitChemMat.at.err.lone' });
  });
});

describe('molecular orbitals', () => {
  const mo = (atom: string, charge = 0) => molecularOrbitals({ atom, charge });
  const order = (o: Outcome) => val(o, 'kitChemMat.at.row.bondOrder');
  const unpaired = (o: Outcome) => str(o, 'kitChemMat.at.row.unpaired');

  it('writes the charge of the ion as superscript digits: O2 with charge -2 is O₂²⁻', () => {
    expect(str(mo('O', -2), 'kitChemMat.at.row.molecule')).toBe('O₂²⁻');
    expect(str(mo('O', -1), 'kitChemMat.at.row.molecule')).toBe('O₂⁻');
  });

  it('bond orders: N2 3, O2 2, O2- 1.5, B2 1, C2 2, F2 1, H2 1, Li2 1', () => {
    expect([
      order(mo('N')),
      order(mo('O')),
      order(mo('O', -1)),
      order(mo('B')),
      order(mo('C')),
      order(mo('F')),
      order(mo('H')),
      order(mo('Li')),
    ]).toEqual([3, 2, 1.5, 1, 2, 1, 1, 1]);
  });

  it('magnetism: O2 has 2 unpaired electrons and is paramagnetic; B2 is paramagnetic; N2 and C2 are diamagnetic', () => {
    expect(unpaired(mo('O'))).toBe('2');
    expect(word(mo('O'), 'kitChemMat.at.row.magnetism')).toBe('kitChemMat.at.word.paramagnetic');
    expect(unpaired(mo('B'))).toBe('2');
    expect(word(mo('B'), 'kitChemMat.at.row.magnetism')).toBe('kitChemMat.at.word.paramagnetic');
    expect(unpaired(mo('N'))).toBe('0');
    expect(word(mo('N'), 'kitChemMat.at.row.magnetism')).toBe('kitChemMat.at.word.diamagnetic');
    expect(word(mo('C'), 'kitChemMat.at.row.magnetism')).toBe('kitChemMat.at.word.diamagnetic');
    expect(unpaired(mo('O', -1))).toBe('1');
  });

  it('ions: H2+ is 0.5, N2+ is 2.5, O2+ is 2.5; He2, Be2 and Ne2 have bond order 0', () => {
    expect(order(mo('H', 1))).toBe(0.5);
    expect(order(mo('N', 1))).toBe(2.5);
    expect(order(mo('O', 1))).toBe(2.5);
    expect(order(mo('He'))).toBe(0);
    expect(order(mo('Be'))).toBe(0);
    expect(order(mo('Ne'))).toBe(0);
    expect(word(mo('He'), 'kitChemMat.at.row.stable')).toBe('kitChemMat.at.word.unbound');
  });

  it('s-p mixing puts sigma 2p above pi 2p through N2 and below it from O2', () => {
    const names = (o: Outcome) => (o.ok ? o.tables![0].rows.map((r) => r[0]) : []);
    expect(names(mo('N'))).toEqual(['σ*2p', 'π*2p', 'σ2p', 'π2p', 'σ*2s', 'σ2s']);
    expect(names(mo('O'))).toEqual(['σ*2p', 'π*2p', 'π2p', 'σ2p', 'σ*2s', 'σ2s']);
  });

  it('electrons spread over a degenerate set before pairing (Hund)', () => {
    const order3 = [{ name: 'p', capacity: 4, degeneracy: 2, bonding: true }];
    expect(fillOrbitals(order3, 2).filled[0].spin).toEqual([1, 1]);
    expect(fillOrbitals(order3, 3).filled[0].spin).toEqual([2, 1]);
    expect(fillOrbitals(order3, 4).filled[0].spin).toEqual([2, 2]);
  });

  it('refuses heavy atoms, impossible charges and too many electrons', () => {
    expect(mo('Na')).toMatchObject({ key: 'kitChemMat.at.err.moAtom' });
    expect(mo('Xx')).toMatchObject({ key: 'kitChemMat.at.err.moAtom' });
    expect(mo('H', 3)).toMatchObject({ key: 'kitChemMat.at.err.moElectrons' });
    expect(mo('Ne', -3)).toMatchObject({ key: 'kitChemMat.at.err.moElectrons' });
    expect(mo('N', 0.5)).toMatchObject({ key: 'kitChemMat.at.err.moCharge' });
  });
});
