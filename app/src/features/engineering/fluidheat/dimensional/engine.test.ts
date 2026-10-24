import { describe, expect, it } from 'vitest';
import { parseUnit } from '../../../../core/units';
import { CalcError } from '../numeric';
import { piGroups, scaleModel, type Variable } from './engine';

const v = (name: string, unit: string): Variable => ({ name, dim: parseUnit(unit)!.dim });
const text = (g: { exponents: { n: number; d: number }[] }, vars: Variable[]) =>
  g.exponents.map((e, i) => (e.n === 0 ? '' : `${vars[i].name}^${e.n}/${e.d}`)).filter(Boolean);

describe('Buckingham pi groups', () => {
  it('sphere drag F(D, V, rho, mu): F/(rho V^2 D^2) and Reynolds', () => {
    const vars = [v('F', 'N'), v('D', 'm'), v('V', 'm/s'), v('rho', 'kg/m^3'), v('mu', 'Pa·s')];
    const r = piGroups(vars);
    expect(r.rank).toBe(3);
    expect(r.groups).toHaveLength(2);
    expect(text(r.groups[0], vars)).toEqual(['F^1/1', 'D^-2/1', 'V^-2/1', 'rho^-1/1']);
    expect(r.groups[1].named).toBe('reynolds');
    expect(text(r.groups[1], vars)).toEqual(['D^1/1', 'V^1/1', 'rho^1/1', 'mu^-1/1']);
  });
  it('pipe pressure drop gives four groups: dp/(rho V^2), L/D, eps/D, Re', () => {
    const vars = [
      v('dp', 'Pa'),
      v('D', 'm'),
      v('L', 'm'),
      v('V', 'm/s'),
      v('rho', 'kg/m^3'),
      v('mu', 'Pa·s'),
      v('eps', 'm'),
    ];
    const r = piGroups(vars);
    expect(r.groups).toHaveLength(4);
    expect(r.repeating).toEqual(['D', 'V', 'rho']);
    expect(text(r.groups[0], vars)).toEqual(['dp^1/1', 'V^-2/1', 'rho^-1/1']);
    expect(text(r.groups[1], vars)).toEqual(['D^-1/1', 'L^1/1']);
    expect(r.groups.some((g) => g.named === 'reynolds' && g.inverted)).toBe(true);
    expect(text(r.groups[3], vars)).toEqual(['D^-1/1', 'eps^1/1']);
  });
  it('pendulum period T(L, g, m): one group T sqrt(g/L), mass drops out', () => {
    const vars = [v('T', 's'), v('L', 'm'), v('g', 'm/s^2'), v('m', 'kg')];
    const r = piGroups(vars);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].exponents.map((e) => `${e.n}/${e.d}`)).toEqual(['1/1', '-1/2', '1/2', '0/1']);
  });
  it('honours a chosen set of repeating variables', () => {
    const vars = [v('F', 'N'), v('D', 'm'), v('V', 'm/s'), v('rho', 'kg/m^3'), v('mu', 'Pa·s')];
    const r = piGroups(vars, ['D', 'V', 'mu']);
    expect(r.repeating).toEqual(['D', 'V', 'mu']);
    expect(r.groups).toHaveLength(2);
  });
  it('rejects bad input with clear messages', () => {
    expect(() => piGroups([v('x', 'm')])).toThrow(CalcError);
    expect(() => piGroups([v('x', 'm'), v('x', 's')])).toThrow(/used twice/);
    expect(() => piGroups([v('a', 'm'), v('b', 'kg')])).toThrow(/independent/);
    const vars = [v('F', 'N'), v('D', 'm'), v('V', 'm/s'), v('rho', 'kg/m^3')];
    expect(() => piGroups(vars, ['D', 'D', 'V'])).toThrow(CalcError);
    expect(() => piGroups(vars, ['F', 'D', 'V'])).toThrow(CalcError);
    expect(() => piGroups(vars, ['D'])).toThrow(/exactly 3/);
  });
});

describe('model scaling', () => {
  it('car 1:5 tested in water at matched Re, prototype 30 m/s in air: model 10.0 m/s', () => {
    const r = scaleModel({
      criterion: 'reynolds',
      lengthRatio: 1 / 5,
      prototypeSpeed: 30,
      nuPrototype: 1.5e-5,
      nuModel: 1.0e-6,
    });
    expect(r.modelSpeed).toBeCloseTo(10, 9);
  });
  it('Froude scaling and force ratio with densities', () => {
    const r = scaleModel({
      criterion: 'froude',
      lengthRatio: 1 / 25,
      prototypeSpeed: 10,
      rhoPrototype: 1025,
      rhoModel: 998,
      modelForce: 2,
    });
    expect(r.modelSpeed).toBeCloseTo(2, 12);
    expect(r.forceRatio).toBeCloseTo((998 / 1025) * (1 / 25) ** 3, 15);
    expect(r.prototypeForce).toBeCloseTo(2 / r.forceRatio, 9);
  });
  it('Mach scaling and errors', () => {
    expect(scaleModel({ criterion: 'mach', lengthRatio: 0.1, prototypeSpeed: 200, aPrototype: 340, aModel: 300 }).modelSpeed).toBeCloseTo(
      (200 * 300) / 340,
      9,
    );
    expect(() => scaleModel({ criterion: 'reynolds', lengthRatio: 0, prototypeSpeed: 1 })).toThrow(CalcError);
    expect(() => scaleModel({ criterion: 'reynolds', lengthRatio: 1, prototypeSpeed: 1 })).toThrow(CalcError);
    expect(() => scaleModel({ criterion: 'mach', lengthRatio: 1, prototypeSpeed: -1, aPrototype: 1, aModel: 1 })).toThrow(CalcError);
  });
});
