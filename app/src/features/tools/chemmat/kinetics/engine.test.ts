import { describe, expect, it } from 'vitest';
import {
  arrhenius,
  concentrationAt,
  globalRate,
  halfLife,
  initialRates,
  integrated,
  linearizations,
  multiFit,
  orderFromData,
  parseTable,
  timeTo,
} from './engine';
import type { Outcome } from '../types';

const val = (o: Outcome, key: string, vars?: Record<string, string>): number => {
  if (!o.ok) throw new Error(o.key);
  const r = o.rows.find((x) => x.key === key && (!vars || JSON.stringify(x.keyVars) === JSON.stringify(vars)));
  if (!r || typeof r.value !== 'number') throw new Error(`no ${key}`);
  return r.value;
};
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe('integrated rate laws', () => {
  it('first order k = 0.0231 per minute has a half-life of 30.006 minutes', () => {
    const o = integrated({ order: 1, k: 0.0231, c0: 1, t: 30.006, target: NaN, tunit: 'min' });
    expect(rel(val(o, 'kitChemMat.kin.row.half'), 30.006)).toBeLessThan(1e-4);
    expect(rel(val(o, 'kitChemMat.kin.row.half'), Math.log(2) / 0.0231)).toBeLessThan(1e-12);
    expect(Math.abs(val(o, 'kitChemMat.kin.row.conc') - 0.5)).toBeLessThan(1e-5);
  });

  it('zero and second order agree with their closed forms and with each other through timeTo', () => {
    expect(concentrationAt(0, 0.01, 1, 20)).toBeCloseTo(0.8, 12);
    expect(concentrationAt(2, 0.5, 2, 3)).toBeCloseTo(2 / (1 + 0.5 * 2 * 3), 12);
    expect(halfLife(0, 0.01, 1)).toBeCloseTo(50, 12);
    expect(halfLife(2, 0.5, 2)).toBeCloseTo(1, 12);
    for (const order of [0, 1, 2]) {
      const t = timeTo(order, 0.02, 1, 0.3);
      expect(concentrationAt(order, 0.02, 1, t)).toBeCloseTo(0.3, 10);
    }
  });

  it('a zero-order reaction cannot go below zero', () => {
    expect(concentrationAt(0, 1, 1, 100)).toBe(0);
  });

  it('time to a target concentration is reported', () => {
    const o = integrated({ order: 1, k: 0.1, c0: 1, t: 0, target: 0.25, tunit: 's' });
    expect(rel(val(o, 'kitChemMat.kin.row.timeTo'), Math.log(4) / 0.1)).toBeLessThan(1e-12);
  });

  it('rejects impossible input', () => {
    const base = { order: 1, k: 0.1, c0: 1, t: 1, target: NaN, tunit: 's' };
    expect(integrated({ ...base, order: 3 })).toMatchObject({ ok: false });
    expect(integrated({ ...base, k: 0 })).toMatchObject({ ok: false });
    expect(integrated({ ...base, k: -1 })).toMatchObject({ ok: false });
    expect(integrated({ ...base, c0: 0 })).toMatchObject({ ok: false });
    expect(integrated({ ...base, t: -1 })).toMatchObject({ ok: false });
    expect(integrated({ ...base, target: 2 })).toMatchObject({ ok: false });
  });
});

describe('order from data', () => {
  const k = 0.05;
  const times = [0, 10, 20, 30, 40, 60];
  const first = times.map((t) => `${t}, ${Math.exp(-k * t)}`).join('\n');

  it('data that are exactly first order give R^2 of 1 for ln[A] and less for the others', () => {
    const fits = linearizations(
      times,
      times.map((t) => Math.exp(-k * t)),
    );
    const byOrder = Object.fromEntries(fits.map((f) => [f.order, f.fit.r2]));
    expect(Math.abs(byOrder[1] - 1)).toBeLessThan(1e-12);
    expect(byOrder[0]).toBeLessThan(0.99999);
    expect(byOrder[2]).toBeLessThan(0.99999);
    const o = orderFromData(first, 'min');
    expect(val(o, 'kitChemMat.kin.row.order')).toBe(1);
    expect(rel(val(o, 'kitChemMat.kin.row.k'), k)).toBeLessThan(1e-9);
  });

  it('second-order data choose second order and zero-order data choose zero order', () => {
    const second = times.map((t) => `${t}, ${1 / (1 + 0.02 * t)}`).join('\n');
    expect(val(orderFromData(second, 's'), 'kitChemMat.kin.row.order')).toBe(2);
    const zero = times.map((t) => `${t}, ${2 - 0.01 * t}`).join('\n');
    const o = orderFromData(zero, 's');
    expect(val(o, 'kitChemMat.kin.row.order')).toBe(0);
    expect(rel(val(o, 'kitChemMat.kin.row.k'), 0.01)).toBeLessThan(1e-9);
  });

  it('rejects bad tables', () => {
    expect(orderFromData('1, 2\n3, 4', 's')).toMatchObject({ ok: false });
    expect(orderFromData('0, 1\n1, x\n2, 0.5', 's')).toMatchObject({ ok: false });
    expect(orderFromData('0, 1\n1, 0.5\n2', 's')).toMatchObject({ ok: false });
    expect(orderFromData('0, 1\n1, 0\n2, 0.5', 's')).toMatchObject({ ok: false });
    expect(orderFromData('1, 1\n1, 0.5\n1, 0.2', 's')).toMatchObject({ ok: false });
    expect(orderFromData('0, 1\n1, 2\n2, 3', 's')).toMatchObject({ ok: false });
  });

  it('reads tables with commas, spaces, and tabs', () => {
    expect(parseTable('1, 2\n3\t4\n5 6')).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
    expect(parseTable('1, a')).toBeNull();
  });
});

describe('initial rates', () => {
  it('recovers the orders and k from exact rate = 0.5 [A]^2 [B]', () => {
    const exps = [
      [0.1, 0.1],
      [0.2, 0.1],
      [0.1, 0.2],
      [0.3, 0.4],
    ];
    const text = exps.map(([a, b]) => `${a}, ${b}, ${0.5 * a * a * b}`).join('\n');
    const o = initialRates(text, 2);
    expect(Math.abs(val(o, 'kitChemMat.kin.row.fitOrder', { name: 'A' }) - 2)).toBeLessThan(1e-9);
    expect(Math.abs(val(o, 'kitChemMat.kin.row.fitOrder', { name: 'B' }) - 1)).toBeLessThan(1e-9);
    expect(rel(val(o, 'kitChemMat.kin.row.k'), 0.5)).toBeLessThan(1e-9);
    expect(val(o, 'kitChemMat.kin.row.overall')).toBe(3);
  });

  it('asks for varied experiments when the columns are dependent', () => {
    expect(initialRates('0.1, 0.1, 1\n0.2, 0.2, 2\n0.3, 0.3, 3', 2)).toMatchObject({ ok: false });
  });

  it('solves a small linear system', () => {
    const beta = multiFit([[1], [2], [3], [4]], [3, 5, 7, 9]);
    expect(beta![0]).toBeCloseTo(1, 10);
    expect(beta![1]).toBeCloseTo(2, 10);
  });
});

describe('Arrhenius', () => {
  it('k = 1e-3 at 300 K and 1e-2 at 320 K gives Ea = 91.895 kJ/mol', () => {
    const o = arrhenius('300, 0.001\n320, 0.01', NaN);
    expect(rel(val(o, 'kitChemMat.kin.row.Ea'), 91895)).toBeLessThan(1e-4);
    const direct = (8.314462618 * Math.log(10)) / (1 / 300 - 1 / 320);
    expect(rel(val(o, 'kitChemMat.kin.row.Ea'), direct)).toBeLessThan(1e-12);
  });

  it('a table that is exactly Arrhenius gives back A and Ea, and predicts k', () => {
    const A = 1e13;
    const Ea = 75000;
    const temps = [280, 300, 320, 340, 360];
    const text = temps.map((T) => `${T}, ${A * Math.exp(-Ea / (8.314462618 * T))}`).join('\n');
    const o = arrhenius(text, 310);
    expect(rel(val(o, 'kitChemMat.kin.row.Ea'), Ea)).toBeLessThan(1e-9);
    expect(rel(val(o, 'kitChemMat.kin.row.A'), A)).toBeLessThan(1e-7);
    expect(rel(val(o, 'kitChemMat.kin.row.kAt'), A * Math.exp(-Ea / (8.314462618 * 310)))).toBeLessThan(1e-7);
  });

  it('rejects one point, equal temperatures, and non-positive values', () => {
    expect(arrhenius('300, 0.1', NaN)).toMatchObject({ ok: false });
    expect(arrhenius('300, 0.1\n300, 0.2', NaN)).toMatchObject({ ok: false });
    expect(arrhenius('300, 0.1\n-5, 0.2', NaN)).toMatchObject({ ok: false });
    expect(arrhenius('300, 0.1\n310, 0', NaN)).toMatchObject({ ok: false });
  });
});

describe('global rate', () => {
  it('matches the formula and rejects bad input', () => {
    const o = globalRate({ A: 1e10, Ea: 150000, T: 1000, cF: 0.01, a: 0.5, cO: 0.02, b: 1 });
    const k = 1e10 * Math.exp(-150000 / (8.314462618 * 1000));
    expect(rel(val(o, 'kitChemMat.kin.row.rate'), k * Math.pow(0.01, 0.5) * 0.02)).toBeLessThan(1e-12);
    expect(globalRate({ A: 0, Ea: 1, T: 1000, cF: 1, a: 1, cO: 1, b: 1 })).toMatchObject({ ok: false });
    expect(globalRate({ A: 1, Ea: 1, T: 0, cF: 1, a: 1, cO: 1, b: 1 })).toMatchObject({ ok: false });
  });
});
