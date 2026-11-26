import '../text';
import { describe, expect, it } from 'vitest';
import { cell } from './engine';
import { cellFromNotation } from './notation';
import type { Outcome } from '../types';

const num = (o: Outcome, key: string): number => {
  if (!o.ok) throw new Error(o.key);
  const r = o.rows.find((x) => x.key === key);
  if (!r || typeof r.value !== 'number') throw new Error(`no ${key}`);
  return r.value;
};

describe('cell notation', () => {
  it('Zn(s) | Zn2+(0.1 M) || Cu2+(0.001 M) | Cu(s) matches the picked Daniell cell', () => {
    const o = cellFromNotation({ notation: 'Zn(s) | Zn2+(0.1 M) || Cu2+(0.001 M) | Cu(s)', T: 298.15 });
    const picked = cell({ a: 'Zn', b: 'Cu', concA: 'Zn2+ = 0.1', concB: 'Cu2+ = 0.001', T: 298.15 });
    expect(num(o, 'kitChemMat.ec.row.E')).toBe(num(picked, 'kitChemMat.ec.row.E'));
    // independent: E = E0 - (RT / 2F) ln([Zn2+] / [Cu2+]) with E0 near 1.10 V
    const e = 1.1015 - ((8.314462618 * 298.15) / (2 * 96485.33212)) * Math.log(100);
    expect(Math.abs(num(o, 'kitChemMat.ec.row.E') - e)).toBeLessThan(2e-4);
  });

  it('defaults amounts to 1, accepts a platinum electrode, and flags a reversed cell', () => {
    const o = cellFromNotation({ notation: 'Pt | H2(g) | H+(aq) || Cu2+(aq) | Cu(s)', T: 298.15 });
    expect(Math.abs(num(o, 'kitChemMat.ec.row.E') - 0.34)).toBeLessThan(0.02);
    const flipped = cellFromNotation({ notation: 'Cu(s) | Cu2+ || Zn2+ | Zn(s)', T: 298.15 });
    expect(flipped.ok && flipped.notes[0].key).toBe('kitChemMat.ec.note.notationFlipped');
  });

  it('refuses text without a salt bridge and species it does not know', () => {
    expect(cellFromNotation({ notation: 'Zn | Zn2+', T: 298.15 })).toMatchObject({ key: 'kitChemMat.ec.err.notation' });
    expect(cellFromNotation({ notation: 'Zn | Zn2+ || Xx3+ | Xx', T: 298.15 })).toMatchObject({
      key: 'kitChemMat.ec.err.notationHalf',
    });
  });
});
