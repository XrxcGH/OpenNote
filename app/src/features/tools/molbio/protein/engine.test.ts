import { describe, expect, it } from 'vitest';
import { KitError } from '../shared';
import { runTool } from '../spec';
import { PKA_SETS } from './data';
import {
  cleanProtein,
  extinction,
  fragmentIons,
  gravy,
  groups,
  hill,
  hydropathy,
  isoelectric,
  masses,
  netCharge,
  wheel,
} from './engine';
import { spec } from './tool';

const errorKey = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (error instanceof KitError) return error.key;
    throw error;
  }
  return 'no error';
};

const user = { nTerm: 9.0, cTerm: 2.0, K: 10.5, R: 12.5, H: 6.0, D: 3.9, E: 4.1, C: 8.3, Y: 10.1 };

describe('protein masses', () => {
  it('gives GGG a monoisotopic mass of 189.074956 and an average mass of 189.171', () => {
    const m = masses('GGG');
    expect(m.mono).toBeCloseTo(189.074956, 5);
    expect(m.average).toBeCloseTo(189.171, 5);
    expect(hill(m.formula)).toBe('C6H11N3O4');
  });

  it('applies disulfide, acetyl, amide and phosphate changes', () => {
    const base = masses('CC').mono;
    expect(masses('CC', { disulfides: 1, acetyl: false, amide: false, phospho: 0 }).mono - base).toBeCloseTo(
      -2.01565,
      5,
    );
    expect(masses('S', { disulfides: 0, acetyl: true, amide: false, phospho: 0 }).mono - masses('S').mono).toBeCloseTo(
      42.010565,
      5,
    );
    expect(masses('S', { disulfides: 0, acetyl: false, amide: true, phospho: 0 }).mono - masses('S').mono).toBeCloseTo(
      -0.984016,
      5,
    );
    expect(masses('S', { disulfides: 0, acetyl: false, amide: false, phospho: 1 }).mono - masses('S').mono).toBeCloseTo(
      79.966331,
      5,
    );
  });

  it('refuses more disulfides than cysteine pairs and more phosphates than S, T and Y', () => {
    expect(errorKey(() => masses('CAC', { disulfides: 2, acetyl: false, amide: false, phospho: 0 }))).toBe(
      'protein.e.tooManyDisulfides',
    );
    expect(errorKey(() => masses('GA', { disulfides: 0, acetyl: false, amide: false, phospho: 1 }))).toBe(
      'protein.e.tooManyPhospho',
    );
  });
});

describe('extinction, hydropathy and the wheel', () => {
  it('gives 15720 for 2 W, 3 Y and 2 cystines', () => {
    expect(extinction('WWYYYCCCC', 2)).toBe(15720);
  });

  it('gives MKWVTFISLLFLFSSAYS a GRAVY of 1.23333', () => {
    expect(gravy('MKWVTFISLLFLFSSAYS')).toBeCloseTo(1.233333, 6);
  });

  it('takes window means at the middle residue', () => {
    const h = hydropathy('AIK', 3);
    expect(h.mids).toEqual([2]);
    expect(h.values[0]).toBeCloseTo((1.8 + 4.5 - 3.9) / 3, 12);
    expect(errorKey(() => hydropathy('AIK', 4))).toBe('protein.e.windowLong');
  });

  it('places residues 100 degrees apart', () => {
    expect(wheel('AAAA').angles).toEqual([0, 100, 200, 300]);
  });
});

describe('charge and isoelectric point', () => {
  it('puts the pI of GK at 9.75 with pKa 9.0, 2.0 and 10.5', () => {
    expect(isoelectric(groups('GK', user)).pI).toBeCloseTo(9.75, 4);
  });

  it('uses residue-specific terminal pKa in the Bjellqvist set', () => {
    const list = groups('AKD', PKA_SETS.bjellqvist);
    expect(list.find((g) => g.name === 'N')?.pKa).toBe(7.59);
    expect(list.find((g) => g.name === 'C-term')?.pKa).toBe(4.55);
  });

  it('gives a charge of +1 for lysine well below its pKa, after the C-terminus is ionized', () => {
    const list = groups('K', user, { disulfides: 0, acetyl: true, amide: true, phospho: 0 });
    expect(netCharge(list, 7)).toBeCloseTo(1, 3);
    expect(errorKey(() => isoelectric(list))).toBe('protein.e.noPi');
  });
});

describe('fragment ions', () => {
  it('gives b1 of G 58.0287402 and y1 of A 90.0549549', () => {
    const ions = fragmentIons('GA');
    expect(ions[0]!.b).toBeCloseTo(58.0287402, 5);
    expect(ions[0]!.y).toBeCloseTo(90.0549549, 5);
  });
});

describe('reading a protein', () => {
  it('drops headers, numbers, spaces and a final stop', () => {
    expect(cleanProtein('>p\n1 mkw vt*')).toBe('MKWVT');
  });

  it('names a character that is not an amino acid', () => {
    expect(errorKey(() => cleanProtein('MKB'))).toBe('protein.e.badResidue');
    expect(errorKey(() => cleanProtein(''))).toBe('protein.e.noProtein');
  });
});

describe('the protein tool', () => {
  it('answers every mode on its example without an error', () => {
    for (const mode of ['properties', 'charge', 'hydropathy', 'wheel', 'ions', 'reference']) {
      expect(runTool(spec, { mode }).ok, mode).toBe(true);
    }
  });

  it('turns an A280 into a concentration', () => {
    const result = runTool(spec, { mode: 'properties', seq: 'WY', a280: '0.699', path: '1' });
    expect(result.ok && result.rows.find((row) => row.key === 'protein.r.concM')?.value).toBe('100 µM');
  });
});
