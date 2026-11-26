import '../text';
import { describe, expect, it } from 'vitest';
import { buffer, fractions, parseConstants, solution, speciesAtPh, titration, titrationPh } from './engine';
import type { Outcome } from '../types';

const row = (o: Outcome, key: string): number => {
  if (!o.ok) throw new Error(o.key);
  const r = o.rows.find((x) => x.key === key);
  if (!r || typeof r.value !== 'number') throw new Error(`no ${key}`);
  return r.value;
};
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe('weak acids and bases', () => {
  it('0.1 M acetic acid', () => {
    const o = solution({ kind: 'acid', C: 0.1, constants: [1.8e-5], strongBase: 0, strongAcid: 0 });
    expect(Math.abs(row(o, 'kitChemMat.ab.row.h') - 1.3327e-3)).toBeLessThan(1e-7);
    expect(Math.abs(row(o, 'kitChemMat.ab.row.pH') - 2.8753)).toBeLessThan(1e-4);
    // Independent quadratic x^2 + Ka x - Ka C = 0 (water's own H+ is negligible here).
    const x = (-1.8e-5 + Math.sqrt(1.8e-5 ** 2 + 4 * 1.8e-5 * 0.1)) / 2;
    expect(rel(row(o, 'kitChemMat.ab.row.h'), x)).toBeLessThan(1e-5);
  });

  it('0.1 M ammonia', () => {
    const o = solution({ kind: 'base', C: 0.1, constants: [1.8e-5], strongBase: 0, strongAcid: 0 });
    expect(Math.abs(row(o, 'kitChemMat.ab.row.pH') - 11.1247)).toBeLessThan(1e-4);
  });

  it('a very dilute strong acid includes the autoionization of water', () => {
    const o = solution({ kind: 'acid', C: 0, constants: [], strongBase: 0, strongAcid: 1e-8 });
    const h = (1e-8 + Math.sqrt(1e-16 + 4e-14)) / 2;
    expect(rel(row(o, 'kitChemMat.ab.row.h'), h)).toBeLessThan(1e-9);
    expect(row(o, 'kitChemMat.ab.row.pH')).toBeLessThan(7);
  });

  it('neutral water and a strong base alone', () => {
    const w = solution({ kind: 'acid', C: 0, constants: [], strongBase: 1e-30, strongAcid: 0 });
    expect(Math.abs(row(w, 'kitChemMat.ab.row.pH') - 7)).toBeLessThan(1e-6);
    const b = solution({ kind: 'acid', C: 0, constants: [], strongBase: 0.01, strongAcid: 0 });
    expect(Math.abs(row(b, 'kitChemMat.ab.row.pH') - 12)).toBeLessThan(1e-6);
  });

  it('the conjugate base of a weak acid (a salt) is basic, and an ammonium salt acidic', () => {
    // 0.1 M sodium acetate: acid constants Ka with C = strong base = 0.1.
    const o = solution({ kind: 'acid', C: 0.1, constants: [1.8e-5], strongBase: 0.1, strongAcid: 0 });
    const x = Math.sqrt((1e-14 / 1.8e-5) * 0.1);
    expect(Math.abs(row(o, 'kitChemMat.ab.row.pH') - (14 + Math.log10(x)))).toBeLessThan(1e-3);
    const nh4 = solution({ kind: 'acid', C: 0.1, constants: [1e-14 / 1.8e-5], strongBase: 0, strongAcid: 0 });
    expect(row(nh4, 'kitChemMat.ab.row.pH')).toBeLessThan(7);
  });

  it('a polyprotic acid conserves mass and charge', () => {
    const o = solution({ kind: 'acid', C: 0.05, constants: [7.1e-3, 6.3e-8, 4.5e-13], strongBase: 0, strongAcid: 0 });
    if (!o.ok) throw new Error('x');
    const species = o.rows.filter((r) => r.key === 'kitChemMat.ab.row.species');
    expect(species).toHaveLength(4);
    const total = species.reduce((s, r) => s + (r.value as number), 0);
    expect(rel(total, 0.05)).toBeLessThan(1e-9);
    const charge = species.reduce((s, r, i) => s + i * (r.value as number), 0);
    const h = row(o, 'kitChemMat.ab.row.h');
    const oh = row(o, 'kitChemMat.ab.row.oh');
    expect(rel(charge + oh, h)).toBeLessThan(1e-6);
  });

  it('rejects bad input', () => {
    expect(solution({ kind: 'acid', C: -1, constants: [1e-5], strongBase: 0, strongAcid: 0 })).toMatchObject({
      ok: false,
    });
    expect(solution({ kind: 'acid', C: 1, constants: [], strongBase: 0, strongAcid: 0 })).toMatchObject({ ok: false });
    expect(solution({ kind: 'acid', C: 1, constants: [-1], strongBase: 0, strongAcid: 0 })).toMatchObject({
      ok: false,
    });
    expect(solution({ kind: 'base', C: 1, constants: [1e-5, 1e-6], strongBase: 0, strongAcid: 0 })).toMatchObject({
      ok: false,
    });
    expect(solution({ kind: 'acid', C: 0, constants: [], strongBase: 0, strongAcid: 0 })).toMatchObject({ ok: false });
    expect(solution({ kind: 'acid', C: 0, constants: [], strongBase: 0, strongAcid: 1e6 })).toMatchObject({
      ok: false,
    });
  });
});

describe('buffers', () => {
  it('equal acid and base: pH = pKa', () => {
    const o = buffer({ Ka: 1.8e-5, Ca: 0.1, Cb: 0.1, addBase: 0, addAcid: 0 });
    // Henderson-Hasselbalch gives pKa = 4.7447; the exact balance adds the 1.8e-5 M of H+ that the acid gives up.
    expect(Math.abs(row(o, 'kitChemMat.ab.row.hh') - 4.7447)).toBeLessThan(1e-4);
    expect(Math.abs(row(o, 'kitChemMat.ab.row.hh') - -Math.log10(1.8e-5))).toBeLessThan(1e-12);
    const h = Math.pow(10, -row(o, 'kitChemMat.ab.row.pH'));
    expect(Math.abs((1.8e-5 * (0.1 - h)) / (0.1 + h) - h)).toBeLessThan(1e-12);
    expect(Math.abs(row(o, 'kitChemMat.ab.row.pH') - 4.7447)).toBeLessThan(2e-4);
  });

  it('adding strong base moves the pH the way Henderson-Hasselbalch says, and capacity is positive', () => {
    const o = buffer({ Ka: 1.8e-5, Ca: 0.1, Cb: 0.1, addBase: 0.01, addAcid: 0 });
    expect(Math.abs(row(o, 'kitChemMat.ab.row.pH') - (-Math.log10(1.8e-5) + Math.log10(0.11 / 0.09)))).toBeLessThan(
      1e-3,
    );
    expect(row(o, 'kitChemMat.ab.row.capacity')).toBeGreaterThan(0);
  });

  it('a buffer overwhelmed by strong acid is reported', () => {
    expect(buffer({ Ka: 1.8e-5, Ca: 0.1, Cb: 0.1, addBase: 0, addAcid: 0.2 })).toMatchObject({ ok: false });
    expect(buffer({ Ka: 1.8e-5, Ca: 0, Cb: 0, addBase: 0, addAcid: 0 })).toMatchObject({ ok: false });
  });
});

describe('species fractions', () => {
  it('H3PO4 at pH 7', () => {
    const o = speciesAtPh({ constants: [7.1e-3, 6.3e-8, 4.5e-13], pH: 7 });
    if (!o.ok) throw new Error('x');
    const a = o.rows.map((r) => r.value as number);
    expect(rel(a[0], 8.64e-6)).toBeLessThan(2e-3);
    expect(rel(a[1], 0.61349)).toBeLessThan(2e-4);
    expect(rel(a[2], 0.3865)).toBeLessThan(2e-4);
    expect(rel(a[3], 1.74e-6)).toBeLessThan(2e-3);
    expect(Math.abs(a.reduce((s, v) => s + v, 0) - 1)).toBeLessThan(1e-12);
  });

  it('fractions at pH = pKa are one half for a monoprotic acid and sum to one far outside the range', () => {
    expect(fractions(1.8e-5, [1.8e-5])[0]).toBeCloseTo(0.5, 12);
    const far = fractions(1e-16, [7.1e-3, 6.3e-8, 4.5e-13]);
    expect(Math.abs(far.reduce((s, v) => s + v, 0) - 1)).toBeLessThan(1e-12);
    expect(speciesAtPh({ constants: [1e-5], pH: 20 })).toMatchObject({ ok: false });
  });

  it('reads Ka or pKa lists', () => {
    expect(parseConstants('1.8e-5', false)).toEqual([1.8e-5]);
    expect(parseConstants('4.74', true)![0]).toBeCloseTo(1.8197e-5, 8);
    expect(parseConstants('7.1e-3, 6.3e-8', false)).toHaveLength(2);
    expect(parseConstants('abc', false)).toBeNull();
  });
});

describe('titration', () => {
  it('weak acid with strong base: half-equivalence pH is pKa and the equivalence point is basic', () => {
    const o = titration({ constants: [1.8e-5], C0: 0.1, V0: 0.025, Ct: 0.1 });
    expect(Math.abs(row(o, 'kitChemMat.ab.row.pHhalf') - 4.7447)).toBeLessThan(5e-3);
    expect(row(o, 'kitChemMat.ab.row.pHeq')).toBeGreaterThan(8);
    // At equivalence the solution is the salt: compare with the sodium acetate formula for the diluted salt.
    const c = (0.1 * 0.025) / 0.05;
    const x = Math.sqrt((1e-14 / 1.8e-5) * c);
    expect(Math.abs(row(o, 'kitChemMat.ab.row.pHeq') - (14 + Math.log10(x)))).toBeLessThan(2e-3);
    expect(titrationPh([1.8e-5], 0.1, 0.025, 0.1, 0)).toBeCloseTo(2.8753, 3);
  });

  it('a diprotic acid has two equivalence points', () => {
    const o = titration({ constants: [4.5e-7, 4.7e-11], C0: 0.1, V0: 0.02, Ct: 0.1 });
    if (!o.ok) throw new Error('x');
    expect(o.rows.filter((r) => r.key === 'kitChemMat.ab.row.vEq')).toHaveLength(2);
  });

  it('rejects zero or negative amounts', () => {
    expect(titration({ constants: [1e-5], C0: 0, V0: 0.02, Ct: 0.1 })).toMatchObject({ ok: false });
    expect(titration({ constants: [1e-5], C0: 0.1, V0: -1, Ct: 0.1 })).toMatchObject({ ok: false });
    expect(titration({ constants: [], C0: 0.1, V0: 0.02, Ct: 0.1 })).toMatchObject({ ok: false });
  });
});
