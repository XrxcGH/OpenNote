import { describe, expect, it } from 'vitest';
import { bondEnthalpy, bondKey, parseBonds } from './bonds';
import type { Outcome } from '../types';

const dH = (o: Outcome) => {
  if (!o.ok) throw new Error(o.key);
  return (o.rows.find((r) => r.key === 'kitChemMat.thermo.row.dHBonds')!.value as number) / 1e3;
};

describe('bond enthalpy estimate', () => {
  it('CH4 + 2 O2 -> CO2 + 2 H2O: 4(413) + 2(495) - 2(745) - 4(467) = -716 kJ/mol', () => {
    // independent sum: broken 1652 + 990 = 2642; formed 1490 + 1868 = 3358
    expect(dH(bondEnthalpy('4 C-H, 2 O=O', '2 C=O, 4 O-H'))).toBe(-716);
  });

  it('H2 + Cl2 -> 2 HCl is 432 + 239 - 2(427) = -183, with either bond order and "x" counts', () => {
    expect(dH(bondEnthalpy('H-H, Cl-Cl', 'H-Cl x2'))).toBe(-183);
    expect(dH(bondEnthalpy('H-H + Cl-Cl', '2 Cl-H'))).toBe(-183);
  });

  it('reads dashes, triple bonds and counts, and names the bad term', () => {
    expect(bondKey('O–H')).toBe('O-H');
    expect(bondKey('N#N')).toBe('N≡N');
    expect(bondKey('H-O')).toBe('O-H');
    expect(parseBonds('3 C-H, C-C')).toEqual({
      ok: true,
      list: [
        { bond: 'C-H', count: 3 },
        { bond: 'C-C', count: 1 },
      ],
    });
    expect(bondEnthalpy('2 X-Y', 'C-H')).toMatchObject({ key: 'kitChemMat.thermo.err.bond', vars: { term: '2 X-Y' } });
    expect(bondEnthalpy('', 'C-H')).toMatchObject({ key: 'kitChemMat.thermo.err.bondsEmpty' });
  });
});
