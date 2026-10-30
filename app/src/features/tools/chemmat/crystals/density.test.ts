import { describe, expect, it } from 'vitest';
import { density, millerBravais } from './density';
import type { Outcome } from '../types';

const row = (o: Outcome, key: string) => {
  if (!o.ok) throw new Error(o.key);
  const r = o.rows.find((x) => x.key === key);
  if (!r) throw new Error(`no ${key}`);
  return r.value;
};
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const R = 0.128e-9;
const lin = (structure: string, idx: string) =>
  density({ kind: 'linear', structure, known: 'R', length: R, indices: idx });
const pla = (structure: string, idx: string) =>
  density({ kind: 'planar', structure, known: 'R', length: R, indices: idx });
const perR = (o: Outcome, key: 'kitChemMat.cx.row.linearPerR' | 'kitChemMat.cx.row.planarPerR') =>
  row(o, key) as number;

describe('linear density', () => {
  it('FCC [110], BCC [111] and SC [100] are each 1/(2R)', () => {
    expect(rel(perR(lin('fcc', '1 1 0'), 'kitChemMat.cx.row.linearPerR'), 0.5)).toBeLessThan(1e-12);
    expect(rel(perR(lin('bcc', '1 1 1'), 'kitChemMat.cx.row.linearPerR'), 0.5)).toBeLessThan(1e-12);
    expect(rel(perR(lin('sc', '1 0 0'), 'kitChemMat.cx.row.linearPerR'), 0.5)).toBeLessThan(1e-12);
  });

  it('FCC [100] is 1/(2 R sqrt 2) and BCC [100] is sqrt 3 / (4R)', () => {
    expect(rel(perR(lin('fcc', '1 0 0'), 'kitChemMat.cx.row.linearPerR'), 1 / (2 * Math.SQRT2))).toBeLessThan(1e-12);
    expect(rel(perR(lin('bcc', '1 0 0'), 'kitChemMat.cx.row.linearPerR'), Math.sqrt(3) / 4)).toBeLessThan(1e-12);
  });
});

describe('planar density', () => {
  it('FCC (110) is 1/(4 R^2 sqrt 2) and FCC (111) is 1/(2 R^2 sqrt 3)', () => {
    expect(rel(perR(pla('fcc', '1 1 0'), 'kitChemMat.cx.row.planarPerR'), 1 / (4 * Math.SQRT2))).toBeLessThan(1e-12);
    expect(rel(perR(pla('fcc', '1 1 1'), 'kitChemMat.cx.row.planarPerR'), 1 / (2 * Math.sqrt(3)))).toBeLessThan(1e-12);
  });

  it('FCC (100) is 1/(4R^2), BCC (110) is 3/(8 R^2 sqrt 2), BCC (100) is 3/(16 R^2)', () => {
    expect(rel(perR(pla('fcc', '1 0 0'), 'kitChemMat.cx.row.planarPerR'), 1 / 4)).toBeLessThan(1e-12);
    expect(rel(perR(pla('bcc', '1 1 0'), 'kitChemMat.cx.row.planarPerR'), 3 / (8 * Math.SQRT2))).toBeLessThan(1e-12);
    expect(rel(perR(pla('bcc', '1 0 0'), 'kitChemMat.cx.row.planarPerR'), 3 / 16)).toBeLessThan(1e-12);
  });

  it('a lattice parameter works the same as a radius, and non-cubic or empty input is refused', () => {
    const a = 0.3615e-9;
    const byA = density({ kind: 'planar', structure: 'fcc', known: 'a', length: a, indices: '1 1 0' });
    // independent: FCC (110) holds 2 atoms in a rectangle a by a sqrt 2
    expect(rel(row(byA, 'kitChemMat.cx.row.planarDensity') as number, 1e-18 * (2 / (a * a * Math.SQRT2)))).toBeLessThan(
      1e-12,
    );
    expect(density({ kind: 'planar', structure: 'hcp', known: 'a', length: a, indices: '1 1 0' })).toMatchObject({
      ok: false,
    });
    expect(lin('fcc', '0 0 0')).toMatchObject({ key: 'kitChemMat.cx.err.indices' });
  });
});

describe('hexagonal four-index notation', () => {
  const four = (t: string) => row(millerBravais({ direction: 'toFour', indices: t }), 'kitChemMat.cx.row.four');
  const three = (t: string) => row(millerBravais({ direction: 'toThree', indices: t }), 'kitChemMat.cx.row.three');

  it('[100] is [2 -1 -1 0], [110] is [1 1 -2 0], [001] is [0 0 0 1]', () => {
    expect(four('1 0 0')).toBe('[2 -1 -1 0]');
    expect(four('1 1 0')).toBe('[1 1 -2 0]');
    expect(four('0 0 1')).toBe('[0 0 0 1]');
  });

  it('converts back, and the first three indices must add to zero', () => {
    expect(three('2 -1 -1 0')).toBe('[1 0 0]');
    expect(three('1 1 -2 3')).toBe('[1 1 1]');
    expect(millerBravais({ direction: 'toThree', indices: '1 1 1 0' })).toMatchObject({
      key: 'kitChemMat.cx.err.sumFour',
    });
  });
});
