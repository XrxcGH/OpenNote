// The dimensional analysis form end to end.
import { describe, expect, it } from 'vitest';
import { refusal, refuses, row, solver } from '../kit/testing';
import { dimensionalSpec } from './spec';

const solve = solver(dimensionalSpec);

describe('dimensional analysis form', () => {
  it('sphere drag gives two groups, and names the Reynolds number', () => {
    const o = solve();
    expect(row(o, 'rank')).toBe(3);
    expect(row(o, 'count')).toBe(2);
    expect(o.rows.find((r) => r.id === 'repeating')?.value).toBe('D, V, rho');
    const table = o.tables![0].rows;
    expect(table[0][1]).toBe('F·D⁻²·V⁻²·rho⁻¹');
    expect(table[1][1]).toBe('D·V·rho·mu⁻¹');
    expect(table[1][2]).toBe('Reynolds number');
  });
  it('pipe pressure drop gives four groups; the pendulum gives T√(g/L)', () => {
    const pipe = solve({ variables: 'dp, Pa\nD, m\nL, m\nV, m/s\nrho, kg/m^3\nmu, Pa·s\neps, m' });
    expect(pipe.tables![0].rows.map((r) => r[1])).toEqual(['dp·V⁻²·rho⁻¹', 'D⁻¹·L', 'D·V·rho·mu⁻¹', 'D⁻¹·eps']);
    const pendulum = solve({ variables: 'T, s\nL, m\ng, m/s^2\nm, kg' });
    expect(pendulum.tables![0].rows[0][1]).toBe('T·L⁻¹ᐟ²·g¹ᐟ²');
    expect(row(pendulum, 'count')).toBe(1);
  });
  it('takes chosen repeating variables', () => {
    const o = solve({ repeating: 'D, V, mu' });
    expect(o.rows.find((r) => r.id === 'repeating')?.value).toBe('D, V, mu');
  });
  it('scales a model by Reynolds, Froude and Mach number', () => {
    const car = solve({ mode: 'scale' });
    expect(row(car, 'modelSpeed')).toBeCloseTo(10, 9);
    const ship = solve({
      mode: 'scale',
      criterion: 'froude',
      lengthRatio: '0.04',
      prototypeSpeed: '10 m/s',
      rhoPrototype: '1025 kg/m^3',
      rhoModel: '998 kg/m^3',
      modelForce: '2 N',
    });
    expect(row(ship, 'modelSpeed')).toBeCloseTo(2, 12);
    expect(row(ship, 'forceRatio')).toBeCloseTo((998 / 1025) * 0.2 ** 2 * 0.04 ** 2, 15);
    expect(row(ship, 'prototypeForce')).toBeCloseTo(2 / row(ship, 'forceRatio'), 6);
    const mach = solve({
      mode: 'scale',
      criterion: 'mach',
      aPrototype: '340 m/s',
      aModel: '300 m/s',
      prototypeSpeed: '200 m/s',
    });
    expect(row(mach, 'modelSpeed')).toBeCloseTo((200 * 300) / 340, 9);
  });
  it('explains what is wrong', () => {
    expect(refusal(dimensionalSpec, { variables: 'F, N' })).toMatch(/at least two/);
    expect(refusal(dimensionalSpec, { variables: 'F, N\nD, bogus' })).toBe('2');
    expect(refusal(dimensionalSpec, { variables: 'a, m\nb, kg' })).toMatch(/independent/);
    expect(refuses(dimensionalSpec, { repeating: 'F' })).toBe(true);
    expect(refuses(dimensionalSpec, { mode: 'scale', lengthRatio: '0' })).toBe(true);
    expect(refuses(dimensionalSpec, { mode: 'scale', nuModel: '3 kg' })).toBe(true);
  });
});
