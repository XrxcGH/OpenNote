import { describe, expect, it } from 'vitest';
import { convertUnit } from '../../../../core/units';
import { kitThermo } from '../../../../strings/en/kitThermo';
import { THERMO_LOADERS } from '../kit';
import { THERMO_META, THERMO_TOOL_IDS } from '../meta';
import { fmt, tex } from './format';
import { brent, integrate, scanRoots } from './num';
import { fromEngine, toEngine, UNITS } from './units';

describe('thermodynamics kit units', () => {
  it('agree with core/units for every unit core/units knows', () => {
    const pairs: [Parameters<typeof toEngine>[1], string, string, string][] = [
      ['p', 'psia', 'psi', 'kPa'],
      ['p', 'MPa', 'MPa', 'kPa'],
      ['p', 'bar', 'bar', 'kPa'],
      ['p', 'atm', 'atm', 'kPa'],
      ['e', 'Btu/lbm', 'Btu/lb', 'kJ/kg'],
      ['v', 'ft³/lbm', 'ft^3/lb', 'm^3/kg'],
      ['rho', 'lbm/ft³', 'lb/ft^3', 'kg/m^3'],
      ['speed', 'ft/s', 'ft/s', 'm/s'],
      ['power', 'hp', 'hp', 'kW'],
      ['mdot', 'lbm/s', 'lb/s', 'kg/s'],
    ];
    let checked = 0;
    for (const [qty, ours, theirs, base] of pairs) {
      const expected = convertUnit(1, theirs, base);
      if (expected === null) continue;
      checked++;
      expect(Math.abs(toEngine(1, qty, ours) / expected - 1), `${ours}`).toBeLessThan(1e-9);
    }
    expect(checked).toBeGreaterThanOrEqual(6);
  });

  it('converts temperatures with their offsets and back', () => {
    expect(toEngine(32, 'T', '°F')).toBeCloseTo(273.15, 10);
    expect(toEngine(212, 'T', '°F')).toBeCloseTo(373.15, 10);
    expect(toEngine(491.67, 'T', 'R')).toBeCloseTo(273.15, 10);
    expect(toEngine(25, 'T', '°C')).toBeCloseTo(298.15, 12);
    expect(fromEngine(300, 'T', '°F')).toBeCloseTo(80.33, 10);
    expect(toEngine(1, 's', 'Btu/(lbm·R)')).toBeCloseTo(4.1868, 10);
    expect(toEngine(1, 'e', 'Btu/lbm')).toBeCloseTo(2.326, 10);
  });

  it('round-trips every unit', () => {
    for (const [qty, lists] of Object.entries(UNITS)) {
      for (const unit of [...lists.SI, ...lists.US]) {
        const back = fromEngine(
          toEngine(123.456, qty as keyof typeof UNITS, unit.id),
          qty as keyof typeof UNITS,
          unit.id,
        );
        expect(back).toBeCloseTo(123.456, 9);
      }
    }
  });
});

describe('thermodynamics kit numerics and formatting', () => {
  it('finds roots and integrals', () => {
    expect(brent((x) => x * x - 2, 0, 2)).toBeCloseTo(Math.SQRT2, 12);
    expect(scanRoots((x) => Math.sin(x), 0.5, 10)).toHaveLength(3);
    expect(integrate((x) => Math.exp(-x * x), -8, 8)).toBeCloseTo(Math.sqrt(Math.PI), 12);
    expect(() => brent((x) => x * x + 1, -1, 1)).toThrow();
  });

  it('writes numbers plainly or in scientific notation', () => {
    expect(fmt(115.331273, 6)).toBe('115.331');
    expect(fmt(0.00100215, 4)).toBe('0.001002');
    expect(fmt(3.5e-5, 3)).toBe('3.5e-5');
    expect(fmt(2.5e9, 3)).toBe('2.5e9');
    expect(fmt(0)).toBe('0');
    expect(tex(3.5e-5, 3)).toBe('3.5 \\times 10^{-5}');
  });
});

describe('thermodynamics kit list', () => {
  it('names every tool in the strings, the meta list, and the loaders', () => {
    expect(THERMO_META.map((m) => m.id)).toEqual([...THERMO_TOOL_IDS]);
    for (const id of THERMO_TOOL_IDS) {
      expect(kitThermo.open[id]).toBeTruthy();
      expect(kitThermo.keywords[id]).toBeTruthy();
      expect(kitThermo.tab[id]).toBeTruthy();
      expect(THERMO_LOADERS[id]).toBeTypeOf('function');
    }
  });
});
