import { describe, expect, it } from 'vitest';
import { beerLambert, molarMassFromFreezing } from './lab';
import type { Outcome } from '../types';

describe('Beer-Lambert law', () => {
  const base = { unknown: 'A', A: NaN, eps: 12000, b: 1, c: 3e-5 };
  const first = (o: Outcome) => (o.ok ? (o.rows[0].value as number) : NaN);

  it('A = epsilon b c, and each unknown inverts it', () => {
    expect(Math.abs(first(beerLambert(base)) - 0.36)).toBeLessThan(1e-12);
    expect(Math.abs(first(beerLambert({ unknown: 'c', A: 0.36, eps: 12000, b: 1, c: NaN })) - 3e-5)).toBeLessThan(
      1e-16,
    );
    expect(Math.abs(first(beerLambert({ unknown: 'eps', A: 0.36, eps: NaN, b: 1, c: 3e-5 })) - 12000)).toBeLessThan(
      1e-8,
    );
    expect(Math.abs(first(beerLambert({ unknown: 'b', A: 0.72, eps: 12000, b: NaN, c: 3e-5 })) - 2)).toBeLessThan(
      1e-12,
    );
  });

  it('refuses a zero path, zero concentration for epsilon, and negative absorbance', () => {
    expect(beerLambert({ ...base, b: 0 })).toMatchObject({ key: 'kitChemMat.sol.err.pathLength' });
    expect(beerLambert({ unknown: 'eps', A: 0.3, eps: NaN, b: 1, c: 0 })).toMatchObject({
      key: 'kitChemMat.sol.err.concPositive',
    });
    expect(beerLambert({ unknown: 'c', A: -1, eps: 100, b: 1, c: NaN })).toMatchObject({
      key: 'kitChemMat.sol.err.absorbance',
    });
  });
});

describe('molar mass from freezing-point depression', () => {
  const run = (i: number, dT = 0.93) =>
    molarMassFromFreezing({ solvent: 'water', Kf: NaN, soluteMass: 5, solventMass: 100, dT, i });

  it('5.00 g in 100 g of water lowering the freezing point by 0.93 K gives 100 g/mol', () => {
    // independent: molality 0.93 / 1.86 = 0.5 mol/kg; moles = 0.05; M = 5 / 0.05
    const o = run(1);
    expect(o.ok && Math.abs((o.rows[2].value as number) - 100)).toBeLessThan(1e-9);
  });

  it('a dissociating solute with i = 2 doubles the molar mass, and bad input is refused', () => {
    const o = run(2);
    expect(o.ok && Math.abs((o.rows[2].value as number) - 200)).toBeLessThan(1e-9);
    expect(run(1, 0)).toMatchObject({ key: 'kitChemMat.sol.err.depression' });
  });
});
