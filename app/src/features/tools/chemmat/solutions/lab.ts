// Two lab calculations: the Beer-Lambert law A = epsilon b c for any one unknown, and the molar mass of a solute from
// the freezing-point depression of a solution.
import { latexNumber } from '../chemText';
import { fail } from '../types';
import type { Outcome } from '../types';
import { SOLVENTS } from './engine';
import type { SolventName } from './engine';

export interface BeerInput {
  /** Which quantity to find: 'A', 'eps', 'b' or 'c'. */
  unknown: string;
  A: number;
  /** L/(mol cm). */
  eps: number;
  /** Path length, cm. */
  b: number;
  /** mol/L. */
  c: number;
}

const pos = (x: number) => Number.isFinite(x) && x > 0;

export function beerLambert(input: BeerInput): Outcome {
  const { unknown, A, eps, b, c } = input;
  if (!['A', 'eps', 'b', 'c'].includes(unknown)) return fail('kitChemMat.sol.err.beerUnknown');
  if (unknown !== 'A' && !(Number.isFinite(A) && A >= 0)) return fail('kitChemMat.sol.err.absorbance');
  if (unknown !== 'eps' && !pos(eps)) return fail('kitChemMat.sol.err.epsilon');
  if (unknown !== 'b' && !pos(b)) return fail('kitChemMat.sol.err.pathLength');
  if (unknown !== 'c' && !(Number.isFinite(c) && c >= 0)) return fail('kitChemMat.sol.err.conc');
  if (unknown === 'eps' && !(c > 0)) return fail('kitChemMat.sol.err.concPositive');
  if (unknown === 'b' && !(c > 0)) return fail('kitChemMat.sol.err.concPositive');
  const value = { A: eps * b * c, eps: A / (b * c), b: A / (eps * c), c: A / (eps * b) }[unknown]!;
  const rows =
    unknown === 'A'
      ? [{ key: 'kitChemMat.sol.row.absorbance' as const, value, digits: 5 }]
      : unknown === 'eps'
        ? [{ key: 'kitChemMat.sol.row.epsilon' as const, value, unit: 'L/(mol cm)', digits: 5 }]
        : unknown === 'b'
          ? [{ key: 'kitChemMat.sol.row.pathLength' as const, value, unit: 'cm', digits: 5 }]
          : [{ key: 'kitChemMat.sol.row.concBeer' as const, value, dim: 'concentration' as const, digits: 5 }];
  const shown = (name: string, x: number) => `${name}=${latexNumber(x, 5)}`;
  const given = [
    unknown !== 'A' ? shown('A', A) : '',
    unknown !== 'eps' ? shown('\varepsilon', eps) : '',
    unknown !== 'b' ? shown('b', b) : '',
    unknown !== 'c' ? shown('c', c) : '',
  ]
    .filter(Boolean)
    .join(',\ ');
  const symbol = { A: 'A', eps: '\varepsilon', b: 'b', c: 'c' }[unknown]!;
  return {
    ok: true,
    rows,
    steps: [
      { key: 'kitChemMat.sol.step.beerLaw', math: 'A=\varepsilon\,b\,c' },
      { key: 'kitChemMat.sol.step.beerSolve', math: `${given}\ \Rightarrow\ ${symbol}=${latexNumber(value, 5)}` },
    ],
    notes: [{ key: 'kitChemMat.sol.note.beer' }],
    equation: 'A=\varepsilon\,b\,c',
  };
}

export interface MolarMassInput {
  solvent: string;
  /** Used for a custom solvent, K kg/mol. */
  Kf: number;
  /** Mass of solute and of solvent, grams. */
  soluteMass: number;
  solventMass: number;
  /** The freezing-point depression, K (positive). */
  dT: number;
  i: number;
}

/** M = m_solute / (n), with n = (dT / (i Kf)) * kg of solvent. */
export function molarMassFromFreezing(input: MolarMassInput): Outcome {
  const Kf = input.solvent in SOLVENTS ? SOLVENTS[input.solvent as SolventName].Kf : input.Kf;
  if (!pos(Kf)) return fail('kitChemMat.sol.err.constants');
  if (!pos(input.soluteMass) || !pos(input.solventMass)) return fail('kitChemMat.sol.err.massesPositive');
  if (!pos(input.dT)) return fail('kitChemMat.sol.err.depression');
  if (!pos(input.i)) return fail('kitChemMat.sol.err.factor');
  const molality = input.dT / (input.i * Kf);
  const moles = molality * (input.solventMass / 1000);
  const M = input.soluteMass / moles;
  return {
    ok: true,
    rows: [
      { key: 'kitChemMat.sol.row.molality', value: molality, unit: 'mol/kg', digits: 5 },
      { key: 'kitChemMat.sol.row.molesSolute', value: moles, unit: 'mol', digits: 5 },
      { key: 'kitChemMat.sol.row.molarMass', value: M, unit: 'g/mol', digits: 5 },
    ],
    steps: [
      {
        key: 'kitChemMat.sol.step.molalityFrom',
        math: `m=\frac{\Delta T_f}{iK_f}=${latexNumber(molality, 5)}\ \mathrm{mol/kg}`,
      },
      {
        key: 'kitChemMat.sol.step.molarMassFrom',
        math:
          `M=\frac{m_{\text{solute}}}{m\,\cdot\,\text{kg solvent}}=\frac{${latexNumber(input.soluteMass, 5)}\ \mathrm{g}}` +
          `{${latexNumber(moles, 5)}\ \mathrm{mol}}=${latexNumber(M, 5)}\ \mathrm{g/mol}`,
      },
    ],
    notes: [{ key: 'kitChemMat.sol.note.molarMassFreezing' }],
    equation: 'M=\frac{m_{\text{solute}}\,i\,K_f}{\Delta T_f\;m_{\text{solvent}}}',
  };
}
