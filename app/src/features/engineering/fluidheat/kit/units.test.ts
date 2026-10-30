// The unit table is checked against the units reader in core/units: every shown unit, read back, has the
// dimension and size the table says, so a US customary result is converted by a factor that is known to be right.
import { describe, expect, it } from 'vitest';
import { parseUnit } from '../../../../core/units';
import { KINDS, fromShown, readQuantity, toShown, typedUnit, unitOf, type Kind, type System } from './units';

const kinds = Object.keys(KINDS) as Kind[];

describe('the kit units', () => {
  it.each(kinds.flatMap((kind) => (['si', 'us'] as System[]).map((system) => [kind, system] as const)))(
    '%s in %s reads back with the table dimension and factor',
    (kind, system) => {
      const typed = typedUnit(kind, system);
      if (typed === '' || kind === 'temperature') return;
      const unit = parseUnit(typed);
      expect(unit, `${kind} ${system} ${typed}`).not.toBeNull();
      const def = KINDS[kind];
      expect(unit!.dim).toEqual(def.dim);
      const factor = system === 'si' ? def.si.factor : def.us.factor;
      expect(Math.abs(unit!.factor - factor) / factor).toBeLessThan(1e-6);
    },
  );

  it('converts temperatures with their offsets', () => {
    expect(readQuantity('25', 'temperature', 'si')).toBeCloseTo(298.15, 10);
    expect(readQuantity('77', 'temperature', 'us')).toBeCloseTo(298.15, 8);
    expect(readQuantity('300 K', 'temperature', 'us')).toBe(300);
    expect(readQuantity('100 °C', 'temperature', 'us')).toBeCloseTo(373.15, 10);
    expect(toShown(373.15, 'temperature', 'us')).toBeCloseTo(212, 8);
    expect(fromShown(0, 'temperature', 'si')).toBe(273.15);
    expect(unitOf('temperature', 'si')).toBe('°C');
  });

  it('treats a temperature difference without an offset', () => {
    expect(readQuantity('10', 'tempChange', 'si')).toBe(10);
    expect(readQuantity('18', 'tempChange', 'us')).toBeCloseTo(10, 12);
    expect(readQuantity('10 °C', 'tempChange', 'si')).toBe(10);
  });

  it('reads known conversions', () => {
    expect(readQuantity('1 psi', 'pressure', 'si')).toBeCloseTo(6894.757293168, 6);
    expect(readQuantity('1', 'flow', 'us')).toBeCloseTo(6.30901964e-5, 12);
    expect(readQuantity('1', 'conductivity', 'us')).toBeCloseTo(1.7307346, 6);
    expect(readQuantity('1', 'htc', 'us')).toBeCloseTo(5.678263, 5);
    expect(readQuantity('1', 'heat', 'us')).toBeCloseTo(0.2930711, 6);
    expect(readQuantity('1', 'specificHeat', 'us')).toBeCloseTo(4186.8, 1);
    expect(readQuantity('1', 'viscosity', 'si')).toBe(1e-3);
    expect(readQuantity('1', 'viscosity', 'us')).toBeCloseTo(1.488164, 6);
  });

  it('says what was wrong with a unit of the wrong kind or an unreadable one', () => {
    expect(() => readQuantity('3 kN', 'span', 'si')).toThrow();
    expect(() => readQuantity('', 'span', 'si')).toThrow();
    expect(() => readQuantity('abc', 'span', 'si')).toThrow();
  });
});
