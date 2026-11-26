import '../text';
import { describe, expect, it } from 'vitest';
import {
  angle,
  angleBetween,
  cell,
  cubicReflections,
  dCubic,
  dHex,
  indexPattern,
  packingFactor,
  parseIndices,
  pattern,
  scherrer,
  scherrerSize,
  spacing,
  twoTheta,
} from './engine';
import type { CellInput } from './engine';
import type { Outcome } from '../types';

const val = (o: Outcome, key: string): number => {
  if (!o.ok) throw new Error(o.key);
  const r = o.rows.find((x) => x.key === key);
  if (!r || typeof r.value !== 'number') throw new Error(`no ${key}`);
  return r.value;
};
const text = (o: Outcome, key: string): string => {
  if (!o.ok) throw new Error(o.key);
  return String(o.rows.find((x) => x.key === key)?.value);
};
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const NM = 1e-9;
const CU_KA = 0.15406 * NM;
const cu: CellInput = {
  structure: 'fcc',
  known: 'a',
  length: 0.3615 * NM,
  M: 63.546,
  ca: NaN,
  rc: NaN,
  ra: NaN,
};

describe('unit cells', () => {
  it('copper: density 8.9345 g/cm3 from 4 M / (a^3 N_A)', () => {
    const o = cell(cu);
    expect(rel(val(o, 'kitChemMat.cx.row.density'), 8.9345)).toBeLessThan(1e-4);
    // independent: four atoms, lattice parameter converted to cm
    const aCm = 0.3615e-7;
    expect(rel(val(o, 'kitChemMat.cx.row.density'), (4 * 63.546) / (aCm ** 3 * 6.02214076e23))).toBeLessThan(1e-9);
    expect(text(o, 'kitChemMat.cx.row.atoms')).toBe('4');
    expect(text(o, 'kitChemMat.cx.row.coordination')).toBe('12');
  });

  it('packing factors: FCC 0.74048, BCC 0.68017, SC pi/6, diamond pi sqrt(3)/16, ideal HCP equals FCC', () => {
    expect(Math.abs(packingFactor('fcc') - 0.74048)).toBeLessThan(1e-5);
    expect(Math.abs(packingFactor('bcc') - 0.68017)).toBeLessThan(1e-5);
    expect(packingFactor('sc')).toBeCloseTo(Math.PI / 6, 12);
    expect(packingFactor('diamond')).toBeCloseTo(0.34009, 5);
    expect(packingFactor('hcp')).toBeCloseTo(packingFactor('fcc'), 12);
  });

  it('the packing factor shown agrees with N 4/3 pi R^3 / V from the radius', () => {
    // BCC iron, R = 0.1241 nm: a = 4R / sqrt(3)
    const R = 0.1241 * NM;
    const o = cell({ ...cu, structure: 'bcc', known: 'R', length: R, M: 55.845 });
    const a = (4 * R) / Math.sqrt(3);
    expect(rel(val(o, 'kitChemMat.cx.row.a'), a)).toBeLessThan(1e-12);
    expect(rel(val(o, 'kitChemMat.cx.row.apf'), (2 * (4 / 3) * Math.PI * R ** 3) / a ** 3)).toBeLessThan(1e-12);
    // radius to a for FCC: a = 2 R sqrt(2); and for SC a = 2R
    expect(
      rel(val(cell({ ...cu, known: 'R', length: 0.1278 * NM }), 'kitChemMat.cx.row.a'), 2 * 0.1278 * NM * Math.SQRT2),
    ).toBeLessThan(1e-12);
    expect(val(cell({ ...cu, structure: 'sc', known: 'R', length: 1 * NM }), 'kitChemMat.cx.row.a')).toBeCloseTo(
      2 * NM,
      20,
    );
  });

  it('hexagonal close-packed magnesium: volume (3 sqrt 3 / 2) a^2 c and density', () => {
    const o = cell({ ...cu, structure: 'hcp', length: 0.3209 * NM, ca: 0.5211 / 0.3209, M: 24.305 });
    const V = ((3 * Math.sqrt(3)) / 2) * 0.3209 ** 2 * 0.5211; // nm^3
    expect(rel(val(o, 'kitChemMat.cx.row.volume'), V)).toBeLessThan(1e-12);
    expect(rel(val(o, 'kitChemMat.cx.row.density'), (6 * 24.305) / (V * 1e-21 * 6.02214076e23))).toBeLessThan(1e-12);
    expect(val(o, 'kitChemMat.cx.row.density')).toBeGreaterThan(1.7);
    expect(val(o, 'kitChemMat.cx.row.density')).toBeLessThan(1.76);
  });

  it('rock salt density: 4 formula units of 58.44 g/mol in a = 0.5640 nm is 2.165 g/cm3', () => {
    const o = cell({ ...cu, structure: 'nacl', length: 0.564 * NM, M: 58.443 });
    expect(rel(val(o, 'kitChemMat.cx.row.density'), (4 * 58.443) / (0.564e-7 ** 3 * 6.02214076e23))).toBeLessThan(1e-9);
    expect(Math.abs(val(o, 'kitChemMat.cx.row.density') - 2.165)).toBeLessThan(5e-3);
  });

  it('ionic packing factor for rock salt with radii 0.102 and 0.181 nm', () => {
    const o = cell({ ...cu, structure: 'nacl', length: 0.564 * NM, M: NaN, rc: 0.102 * NM, ra: 0.181 * NM });
    expect(
      rel(val(o, 'kitChemMat.cx.row.apf'), (4 * (4 / 3) * Math.PI * (0.102 ** 3 + 0.181 ** 3)) / 0.564 ** 3),
    ).toBeLessThan(1e-12);
    expect(o.ok && o.rows.some((r) => r.key === 'kitChemMat.cx.row.density')).toBe(false);
  });

  it('refuses a missing length, a radius for a compound, and impossible ratios', () => {
    expect(cell({ ...cu, length: 0 })).toMatchObject({ ok: false, key: 'kitChemMat.cx.err.length' });
    expect(cell({ ...cu, length: -1 * NM })).toMatchObject({ ok: false });
    expect(cell({ ...cu, structure: 'nacl', known: 'R' })).toMatchObject({ key: 'kitChemMat.cx.err.compoundRadius' });
    expect(cell({ ...cu, structure: 'hcp', ca: 0 })).toMatchObject({ key: 'kitChemMat.cx.err.ca' });
    expect(cell({ ...cu, M: -3 })).toMatchObject({ key: 'kitChemMat.cx.err.mass' });
  });
});

describe('plane spacing and Bragg angles', () => {
  it('copper (111): d = 0.20871 nm and 2 theta = 43.317 degrees at Cu K-alpha', () => {
    const o = spacing({ system: 'cubic', a: 0.3615 * NM, c: NaN, hkl: '1 1 1', lambda: CU_KA, order: 1 });
    expect(rel(val(o, 'kitChemMat.cx.row.d'), 0.20871 * NM)).toBeLessThan(1e-4);
    expect(rel(val(o, 'kitChemMat.cx.row.twoTheta'), 43.317)).toBeLessThan(1e-4);
    expect(val(o, 'kitChemMat.cx.row.theta') * 2).toBeCloseTo(val(o, 'kitChemMat.cx.row.twoTheta'), 10);
    // independent: sin theta = lambda / (2 d)
    const d = 0.3615 / Math.sqrt(3);
    expect(val(o, 'kitChemMat.cx.row.twoTheta')).toBeCloseTo((2 * Math.asin(0.15406 / (2 * d)) * 180) / Math.PI, 9);
  });

  it('second order reflection of the same plane doubles sin theta', () => {
    const one = spacing({ system: 'cubic', a: 0.3615 * NM, c: NaN, hkl: '1 1 1', lambda: CU_KA, order: 1 });
    const two = spacing({ system: 'cubic', a: 0.3615 * NM, c: NaN, hkl: '1 1 1', lambda: CU_KA, order: 2 });
    const s1 = Math.sin((val(one, 'kitChemMat.cx.row.theta') * Math.PI) / 180);
    const s2 = Math.sin((val(two, 'kitChemMat.cx.row.theta') * Math.PI) / 180);
    expect(rel(s2, 2 * s1)).toBeLessThan(1e-12);
  });

  it('negative indices give the same spacing as positive ones', () => {
    const p = spacing({ system: 'cubic', a: 1, c: NaN, hkl: '1 2 3', lambda: NaN, order: 1 });
    const n = spacing({ system: 'cubic', a: 1, c: NaN, hkl: '-1 2 -3', lambda: NaN, order: 1 });
    expect(val(p, 'kitChemMat.cx.row.d')).toBeCloseTo(val(n, 'kitChemMat.cx.row.d'), 15);
  });

  it('hexagonal: d(10-10) = a sqrt(3) / 2 and d(0002) = c / 2; Miller-Bravais input is accepted', () => {
    const a = 0.3209;
    const c = 0.5211;
    expect(dHex(a, c, 1, 0, 0)).toBeCloseTo((a * Math.sqrt(3)) / 2, 12);
    expect(dHex(a, c, 0, 0, 2)).toBeCloseTo(c / 2, 12);
    const three = spacing({ system: 'hex', a: a * NM, c: c * NM, hkl: '1 0 1', lambda: NaN, order: 1 });
    const four = spacing({ system: 'hex', a: a * NM, c: c * NM, hkl: '1 0 -1 1', lambda: NaN, order: 1 });
    expect(val(four, 'kitChemMat.cx.row.d')).toBeCloseTo(val(three, 'kitChemMat.cx.row.d'), 20);
    expect(text(four, 'kitChemMat.cx.row.bravais')).toBe('(1 0 -1 1)');
    // independent: 1/d^2 = 4/3 (h^2 + hk + k^2)/a^2 + l^2/c^2 with (101)
    const inv = 4 / 3 / (a * a) + 1 / (c * c);
    expect(rel(val(three, 'kitChemMat.cx.row.d') / NM, 1 / Math.sqrt(inv))).toBeLessThan(1e-12);
  });

  it('explains impossible input', () => {
    const base = { system: 'cubic', a: 0.3615 * NM, c: NaN, hkl: '1 1 1', lambda: CU_KA, order: 1 };
    expect(spacing({ ...base, hkl: '0 0 0' })).toMatchObject({ key: 'kitChemMat.cx.err.zero' });
    expect(spacing({ ...base, hkl: '1 1' })).toMatchObject({ key: 'kitChemMat.cx.err.indices' });
    expect(spacing({ ...base, hkl: '1 a 1' })).toMatchObject({ key: 'kitChemMat.cx.err.indices' });
    expect(spacing({ ...base, a: 0 })).toMatchObject({ key: 'kitChemMat.cx.err.length' });
    expect(spacing({ ...base, order: 1.5 })).toMatchObject({ key: 'kitChemMat.cx.err.order' });
    expect(spacing({ ...base, lambda: -1 })).toMatchObject({ key: 'kitChemMat.cx.err.wavelength' });
    // d = a / sqrt(h2+k2+l2) of 0.3615/sqrt(1) is 0.3615 nm, wavelength 0.8 nm exceeds 2d
    expect(spacing({ ...base, hkl: '1 0 0', lambda: 0.8 * NM })).toMatchObject({
      key: 'kitChemMat.cx.err.noReflection',
    });
    expect(spacing({ ...base, system: 'hex', c: 0.5 * NM, hkl: '1 0 0 1' })).toMatchObject({
      key: 'kitChemMat.cx.err.bravais',
    });
    expect(spacing({ ...base, system: 'hex', c: NaN })).toMatchObject({ key: 'kitChemMat.cx.err.c' });
  });

  it('twoTheta returns null beyond the limit and handles very small wavelengths', () => {
    expect(twoTheta(0.1, 0.3)).toBeNull();
    expect(twoTheta(0.1, 0.2)).toBeCloseTo(180, 9);
    expect(twoTheta(1, 1e-6)).toBeCloseTo((2 * Math.asin(0.5e-6) * 180) / Math.PI, 12);
    expect(dCubic(1, 3, 4, 0)).toBeCloseTo(0.2, 12);
  });
});

describe('angles between directions', () => {
  it('[100] and [111] meet at 54.7356 degrees', () => {
    expect(Math.abs(angleBetween([1, 0, 0], [1, 1, 1])! - 54.7356)).toBeLessThan(1e-4);
    const o = angle('1 0 0', '1 1 1');
    expect(Math.abs(val(o, 'kitChemMat.cx.row.angle') - 54.7356)).toBeLessThan(1e-4);
  });

  it('[110] and [111] meet at 35.2644, [100] and [110] at 45, and parallel at 0', () => {
    expect(Math.abs(angleBetween([1, 1, 0], [1, 1, 1])! - 35.2644)).toBeLessThan(1e-4);
    expect(angleBetween([1, 0, 0], [1, 1, 0])).toBeCloseTo(45, 10);
    expect(angleBetween([1, 1, 1], [2, 2, 2])).toBeCloseTo(0, 6);
    expect(angleBetween([1, 0, 0], [-1, 0, 0])).toBeCloseTo(180, 10);
  });

  it('refuses the zero vector and malformed input', () => {
    expect(angle('0 0 0', '1 0 0')).toMatchObject({ ok: false, key: 'kitChemMat.cx.err.zero' });
    expect(angle('1 0', '1 0 0')).toMatchObject({ ok: false, key: 'kitChemMat.cx.err.indices' });
  });

  it('reads brackets and commas', () => {
    expect(parseIndices('[1, -1, 0]')).toEqual([1, -1, 0]);
    expect(parseIndices('(2 1 1)')).toEqual([2, 1, 1]);
    expect(parseIndices('1.5 0 0')).toBeNull();
    expect(parseIndices('')).toBeNull();
  });
});

describe('allowed reflections', () => {
  const rowsOf = (o: Outcome) => (o.ok ? o.tables![0].rows : []);

  it('high-angle lines are kept: Fe to 180 degrees has (310) at 116.39 and (222) at 137.1; Cu has (331) and (420)', () => {
    const fe = rowsOf(pattern({ structure: 'bcc', a: 0.2866 * NM, ca: NaN, lambda: CU_KA, maxTwoTheta: 180 }));
    const f310 = fe.find((r) => r[0] === '310');
    const f222 = fe.find((r) => r[0] === '222');
    expect(Math.abs(Number(f310?.[2]) - 116.39)).toBeLessThan(0.02);
    expect(Math.abs(Number(f222?.[2]) - 137.1)).toBeLessThan(0.1);
    const cu = rowsOf(pattern({ structure: 'fcc', a: 0.3615 * NM, ca: NaN, lambda: CU_KA, maxTwoTheta: 180 })).map(
      (r) => r[0],
    );
    expect(cu).toContain('331');
    expect(cu).toContain('420');
  });

  it('BCC iron at Cu K-alpha: (110) 44.680, (200) 65.033, (211) 82.349 degrees', () => {
    const o = pattern({ structure: 'bcc', a: 0.2866 * NM, ca: NaN, lambda: CU_KA, maxTwoTheta: 90 });
    const rows = rowsOf(o);
    expect(rows.map((r) => r[0])).toEqual(['110', '200', '211']);
    expect(Math.abs(Number(rows[0][2]) - 44.68)).toBeLessThan(1e-3);
    expect(Math.abs(Number(rows[1][2]) - 65.033)).toBeLessThan(1e-3);
    expect(Math.abs(Number(rows[2][2]) - 82.349)).toBeLessThan(1e-3);
    expect(rows.map((r) => r[3])).toEqual(['12', '6', '24']);
  });

  it('FCC copper: only unmixed indices, 111 200 220 311 222', () => {
    const rows = rowsOf(pattern({ structure: 'fcc', a: 0.3615 * NM, ca: NaN, lambda: CU_KA, maxTwoTheta: 100 }));
    expect(rows.map((r) => r[0])).toEqual(['111', '200', '220', '311', '222']);
    expect(Math.abs(Number(rows[0][2]) - 43.317)).toBeLessThan(1e-3);
    expect(rows.map((r) => r[3])).toEqual(['8', '6', '12', '24', '8']);
  });

  it('diamond cubic silicon: 111 220 311 400 (200 and 222 are forbidden)', () => {
    const rows = rowsOf(pattern({ structure: 'diamond', a: 0.5431 * NM, ca: NaN, lambda: CU_KA, maxTwoTheta: 100 }));
    expect(rows.map((r) => r[0].split(', ')[0]).slice(0, 4)).toEqual(['111', '220', '311', '400']);
    expect(rows.map((r) => r[0].split(', ')[0])).not.toContain('200');
    expect(rows.map((r) => r[0].split(', ')[0])).not.toContain('222');
    expect(Math.abs(Number(rows[0][2]) - 28.443)).toBeLessThan(2e-3);
  });

  it('simple cubic shows 100 110 111 200 and skips the 7th line (no sum of three squares)', () => {
    const n = cubicReflections('sc', 9).map((r) => r.N);
    expect(n).toEqual([1, 2, 3, 4, 5, 6, 8, 9]);
    expect(cubicReflections('bcc', 8).map((r) => r.N)).toEqual([2, 4, 6, 8]);
    expect(cubicReflections('fcc', 12).map((r) => r.N)).toEqual([3, 4, 8, 11, 12]);
  });

  it('hexagonal magnesium: (0001) is absent and (10-10) comes first', () => {
    const rows = rowsOf(
      pattern({ structure: 'hcp', a: 0.3209 * NM, ca: 0.5211 / 0.3209, lambda: CU_KA, maxTwoTheta: 80 }),
    );
    expect(rows.slice(0, 3).map((r) => r[0])).toEqual(['1 0 -1 0', '0 0 0 2', '1 0 -1 1']);
    expect(rows.slice(0, 3).map((r) => r[3])).toEqual(['6', '2', '12']);
    // known Cu K-alpha positions of magnesium: 32.19, 34.40, 36.62 degrees
    expect(Math.abs(Number(rows[0][2]) - 32.19)).toBeLessThan(0.02);
    expect(Math.abs(Number(rows[1][2]) - 34.4)).toBeLessThan(0.02);
    expect(Math.abs(Number(rows[2][2]) - 36.62)).toBeLessThan(0.02);
  });

  it('rejects an empty range and bad numbers', () => {
    expect(pattern({ structure: 'fcc', a: 0.3615 * NM, ca: NaN, lambda: CU_KA, maxTwoTheta: 10 })).toMatchObject({
      key: 'kitChemMat.cx.err.noPeaks',
    });
    expect(pattern({ structure: 'fcc', a: 0.3615 * NM, ca: NaN, lambda: CU_KA, maxTwoTheta: 0 })).toMatchObject({
      key: 'kitChemMat.cx.err.maxAngle',
    });
    expect(pattern({ structure: 'fcc', a: 0, ca: NaN, lambda: CU_KA, maxTwoTheta: 90 })).toMatchObject({
      key: 'kitChemMat.cx.err.length',
    });
    expect(pattern({ structure: 'fcc', a: 1, ca: NaN, lambda: NaN, maxTwoTheta: 90 })).toMatchObject({
      key: 'kitChemMat.cx.err.wavelength',
    });
  });
});

describe('indexing a powder pattern', () => {
  const peaksOf = (structure: 'bcc' | 'fcc' | 'sc' | 'diamond', a: number, max: number) => {
    const o = pattern({ structure, a: a * NM, ca: NaN, lambda: CU_KA, maxTwoTheta: max });
    return o.ok ? o.tables![0].rows.map((r) => r[2]).join(' ') : '';
  };

  it('three iron peaks index as BCC with a = 0.2866 nm', () => {
    const o = indexPattern('44.680 65.033 82.349', CU_KA);
    expect(o.ok).toBe(true);
    if (!o.ok) return;
    expect(o.rows[0].word).toBe('kitChemMat.cx.structure.bcc');
    expect(Math.abs(val(o, 'kitChemMat.cx.row.a') / NM - 0.2866)).toBeLessThan(2e-4);
    expect(o.notes.some((n) => n.key === 'kitChemMat.cx.note.others')).toBe(true);
    expect(o.tables![0].rows.map((r) => r[4])).toEqual(['110', '200', '211']);
  });

  it('copper peaks index as FCC with a = 0.3615 nm', () => {
    const o = indexPattern(peaksOf('fcc', 0.3615, 100), CU_KA);
    expect(o.ok && o.rows[0].word).toBe('kitChemMat.cx.structure.fcc');
    expect(Math.abs(val(o, 'kitChemMat.cx.row.a') / NM - 0.3615)).toBeLessThan(1e-4);
  });

  it('a diamond pattern with its 111 220 311 400 lines indexes with a = 0.5431 nm', () => {
    const o = indexPattern(peaksOf('diamond', 0.5431, 100), CU_KA);
    expect(o.ok).toBe(true);
    expect(o.ok && o.rows[0].word).toBe('kitChemMat.cx.structure.diamond');
    expect(Math.abs(val(o, 'kitChemMat.cx.row.a') / NM - 0.5431)).toBeLessThan(1e-3);
  });

  it('silicon lines from a handbook indexes as diamond, not FCC (200 and 222 absent)', () => {
    const o = indexPattern('28.443 47.304 56.122 69.132 76.380 88.033', CU_KA);
    expect(o.ok && o.rows[0].word).toBe('kitChemMat.cx.structure.diamond');
    expect(Math.abs(val(o, 'kitChemMat.cx.row.a') / NM - 0.5431)).toBeLessThan(1e-3);
  });

  it('a simple cubic pattern (Po, a = 0.3359 nm, N = 1-6 and 8) indexes as SC, not BCC', () => {
    const lambda = CU_KA;
    const peaks = [1, 2, 3, 4, 5, 6, 8].map((N) => {
      const s = (lambda * Math.sqrt(N)) / (2 * 0.3359 * NM);
      return ((2 * Math.asin(s)) / Math.PI) * 180;
    });
    const o = indexPattern(peaks.map((p) => p.toFixed(3)).join(' '), lambda);
    expect(o.ok && o.rows[0].word).toBe('kitChemMat.cx.structure.sc');
    expect(Math.abs(val(o, 'kitChemMat.cx.row.a') / NM - 0.3359)).toBeLessThan(1e-4);
  });

  it('peaks given in any order and with commas are sorted before matching', () => {
    const o = indexPattern('82.349, 44.680, 65.033', CU_KA);
    expect(o.ok && o.rows[0].word).toBe('kitChemMat.cx.structure.bcc');
  });

  it('starting the list at a later line is flagged', () => {
    // BCC without its first line: 200, 211, 220 at a = 0.2866 nm.
    const o = indexPattern('65.033 82.349 98.947', CU_KA);
    expect(o.ok).toBe(true);
    if (o.ok) expect(o.notes.some((n) => n.key === 'kitChemMat.cx.note.skipped')).toBe(true);
  });

  it('says when nothing fits, and refuses too few peaks, text and impossible angles', () => {
    expect(indexPattern('30 40 50', CU_KA)).toMatchObject({ ok: false });
    expect(indexPattern('44.68 65.03', CU_KA)).toMatchObject({ key: 'kitChemMat.cx.err.peaks' });
    expect(indexPattern('44.68 x 65.03', CU_KA)).toMatchObject({ key: 'kitChemMat.cx.err.peaks' });
    expect(indexPattern('44.68 65.03 200', CU_KA)).toMatchObject({ key: 'kitChemMat.cx.err.peakRange' });
    expect(indexPattern('44.68 65.03 82.3', 0)).toMatchObject({ key: 'kitChemMat.cx.err.wavelength' });
  });
});

describe('Scherrer crystallite size', () => {
  it('K = 0.9, 0.15406 nm, 2 theta 40 degrees, width 0.5 degrees gives 16.91 nm', () => {
    const tau = scherrerSize(CU_KA, 40, 0.5, 0.9);
    // independent: beta in radians, theta = 20 degrees
    const beta = (0.5 * Math.PI) / 180;
    expect(rel(tau / NM, (0.9 * 0.15406) / (beta * Math.cos((20 * Math.PI) / 180)))).toBeLessThan(1e-12);
    expect(Math.abs(tau / NM - 16.908)).toBeLessThan(2e-3);
    const o = scherrer({ lambda: CU_KA, twoTheta: 40, fwhm: 0.5, K: 0.9 });
    expect(val(o, 'kitChemMat.cx.row.size')).toBeCloseTo(tau, 18);
  });

  it('halving the width doubles the size', () => {
    expect(rel(scherrerSize(CU_KA, 40, 0.25, 0.9), 2 * scherrerSize(CU_KA, 40, 0.5, 0.9))).toBeLessThan(1e-12);
  });

  it('refuses zero, negative and out-of-range input', () => {
    const ok = { lambda: CU_KA, twoTheta: 40, fwhm: 0.5, K: 0.9 };
    expect(scherrer({ ...ok, fwhm: 0 })).toMatchObject({ key: 'kitChemMat.cx.err.width' });
    expect(scherrer({ ...ok, fwhm: -1 })).toMatchObject({ key: 'kitChemMat.cx.err.width' });
    expect(scherrer({ ...ok, twoTheta: 180 })).toMatchObject({ key: 'kitChemMat.cx.err.peakRange' });
    expect(scherrer({ ...ok, K: 0 })).toMatchObject({ key: 'kitChemMat.cx.err.shape' });
    expect(scherrer({ ...ok, lambda: NaN })).toMatchObject({ key: 'kitChemMat.cx.err.wavelength' });
  });
});
