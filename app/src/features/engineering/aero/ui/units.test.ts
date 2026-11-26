import '../text';
import { describe, expect, it } from 'vitest';
import { UNITS, defaultUnit, findUnit, fromSI, toSI, unitsFor } from './units';
import type { QtyKind } from './units';

const close = (actual: number, expected: number, rel = 1e-9) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(rel * Math.abs(expected));

const unit = (kind: QtyKind, sym: string) => {
  const found = findUnit(kind, sym);
  if (!found) throw new Error(`no ${sym}`);
  return found;
};

describe('aerospace units', () => {
  it('builds every unit list, with SI first in SI and US first in US', () => {
    for (const kind of Object.keys(UNITS) as QtyKind[]) {
      expect(UNITS[kind].si.length).toBeGreaterThan(0);
      expect(UNITS[kind].us.length).toBeGreaterThan(0);
      expect(unitsFor(kind, 'us')[0]).toBe(defaultUnit(kind, 'us'));
      expect(unitsFor(kind, 'si')[0]).toBe(defaultUnit(kind, 'si'));
    }
  });

  it('matches exact definitions (independent factors)', () => {
    close(toSI(1, unit('pressure', 'psi')), 6894.757293168361);
    close(toSI(1, unit('pressure', 'lbf/ft²')), 47.88025898033584);
    close(toSI(1, unit('density', 'slug/ft³')), 515.3788183931961);
    close(toSI(1, unit('speed', 'kn')), 0.5144444444444445);
    close(toSI(1, unit('distance', 'nmi')), 1852);
    close(toSI(1, unit('tsfc', 'lbm/(lbf·h)')), 0.45359237 / (4.4482216152605 * 3600));
    close(toSI(1, unit('tsfc', 'mg/(N·s)')), 1e-6);
    close(toSI(1, unit('gasConstant', 'ft·lbf/(slug·°R)')), (0.3048 * 4.4482216152605 * 1.8) / 14.593902937206364);
    close(toSI(1, unit('specificThrust', 'lbf·s/lbm')), 4.4482216152605 / 0.45359237);
    close(toSI(1, unit('rate', '1/h')), 1 / 3600);
    close(toSI(1, unit('psfc', 'lb/(hp·h)')), 4.4482216152605 / (745.6998715822702 * 3600));
    close(toSI(1, unit('psfc', 'N/(kW·h)')), 1 / 3.6e6);
    close(toSI(2, unit('duration', 'h')), 7200);
    // Molar mass in the SI base, kg/mol: 1 kg/kmol and 1 lbm/lbmol are both 1 g/mol.
    close(toSI(1, unit('molarMass', 'kg/kmol')), 1e-3);
    close(toSI(1, unit('molarMass', 'lbm/lbmol')), 1e-3);
  });

  it('converts temperatures with their offsets and round-trips', () => {
    close(toSI(0, unit('temperature', '°C')), 273.15);
    close(toSI(518.67, unit('temperature', '°R')), 288.15);
    close(toSI(59, unit('temperature', '°F')), 288.15);
    close(fromSI(288.15, unit('temperature', '°F')), 59);
    close(toSI(9, unit('tempDiff', '°R')), 5);
  });
});
