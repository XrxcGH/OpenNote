// The function registry: the 48 names tables had before the library (CURRENT.md section 5), each in its family,
// with the argument counts they always had.

import { describe, expect, it } from 'vitest';
import { FUNCTIONS, SPECIAL_FORMS } from '../functions';
import { REGISTRY, arity, buildRegistry, isSpecial, type Family, type FnSpec2 } from '.';

const BY_FAMILY: Partial<Record<Family, string[]>> = {
  math: [
    'ABS',
    'ACOS',
    'ASIN',
    'ATAN',
    'COS',
    'DEGREES',
    'EXP',
    'INT',
    'LN',
    'LOG',
    'LOG10',
    'MOD',
    'PI',
    'POWER',
    'RADIANS',
    'ROUND',
    'ROUNDDOWN',
    'ROUNDUP',
    'SIGN',
    'SIN',
    'SQRT',
    'SUM',
    'TAN',
  ],
  stats: ['AVERAGE', 'COUNT', 'COUNTA', 'MAX', 'MEDIAN', 'MIN'],
  logical: ['AND', 'IF', 'IFERROR', 'NOT', 'OR'],
  info: ['ISBLANK'],
  text: ['CONCAT', 'LEFT', 'LEN', 'LOWER', 'RIGHT', 'TRIM', 'UPPER'],
  datetime: ['DATE', 'DAY', 'DAYS', 'MONTH', 'TODAY', 'YEAR'],
};

describe('the function registry', () => {
  it('holds the 48 names of before, each in its family', () => {
    expect(REGISTRY.size).toBeGreaterThanOrEqual(48);
    for (const [family, names] of Object.entries(BY_FAMILY)) {
      const found = [...REGISTRY.values()].filter((spec) => spec.family === family).map((spec) => spec.name);
      expect(found.sort(), family).toEqual(names);
    }
  });

  it('keeps the argument counts and the kinds the compiler knew', () => {
    expect(Object.keys(FUNCTIONS).length).toBeGreaterThanOrEqual(46);
    expect(SPECIAL_FORMS).toEqual({ IF: { min: 2, max: 3 }, IFERROR: { min: 2, max: 2 } });
    expect(FUNCTIONS.SUM).toMatchObject({ kind: 'aggregate', min: 1, max: Infinity });
    expect(FUNCTIONS.COUNTA).toMatchObject({ kind: 'aggregate', raw: true });
    expect(FUNCTIONS.ROUND).toMatchObject({ kind: 'scalar', min: 1, max: 2 });
    expect(FUNCTIONS.PI).toMatchObject({ min: 0, max: 0 });
    expect(FUNCTIONS.ISBLANK).toMatchObject({ handlesErrors: true });
    expect(FUNCTIONS.CONCAT).toMatchObject({ kind: 'scalar', min: 1, max: Infinity });
    expect(REGISTRY.get('TODAY')?.volatile).toBe(true);
  });

  it('gives every function a signature and an example of our own', () => {
    for (const spec of REGISTRY.values()) {
      expect(spec.meta.signature.startsWith(`${spec.name}(`), spec.name).toBe(true);
      expect(spec.meta.example, spec.name).toMatch(/^=/);
      expect(isSpecial(spec)).toBe(spec.name === 'IF' || spec.name === 'IFERROR');
    }
  });

  it('refuses two functions with one name', () => {
    const one: FnSpec2 = { ...REGISTRY.get('SUM')!, family: 'stats' };
    expect(() => buildRegistry([[REGISTRY.get('SUM')!], [one]])).toThrow(/SUM/);
    expect(arity(one)).toEqual({ min: 1, max: Infinity });
  });
});
