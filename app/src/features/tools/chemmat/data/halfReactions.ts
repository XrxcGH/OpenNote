// Half-reactions for the electrochemistry tool, written as reductions: reactants + n e- -> products. Their standard
// potentials are not typed in; they are computed from the Gibbs energies of formation of the species
// (E = -dG / (n F), with the hydrogen ion and the electron at zero), so they agree with the thermochemistry tool and
// carry the same public sources. Values can differ from a textbook table by a few hundredths of a volt when the
// textbook uses different data for the same couple.
import type { Phase } from './species';

export interface HalfTerm {
  formula: string;
  phase: Phase;
  coefficient: number;
}

export interface HalfReaction {
  id: string;
  react: HalfTerm[];
  prod: HalfTerm[];
  /** Electrons transferred. */
  n: number;
}

const t = (formula: string, phase: Phase, coefficient = 1): HalfTerm => ({ formula, phase, coefficient });

export const HALF_REACTIONS: readonly HalfReaction[] = [
  { id: 'K', react: [t('K+', 'aq')], prod: [t('K', 's')], n: 1 },
  { id: 'Ca', react: [t('Ca2+', 'aq')], prod: [t('Ca', 's')], n: 2 },
  { id: 'Na', react: [t('Na+', 'aq')], prod: [t('Na', 's')], n: 1 },
  { id: 'Mg', react: [t('Mg2+', 'aq')], prod: [t('Mg', 's')], n: 2 },
  { id: 'Al', react: [t('Al3+', 'aq')], prod: [t('Al', 's')], n: 3 },
  { id: 'Zn', react: [t('Zn2+', 'aq')], prod: [t('Zn', 's')], n: 2 },
  { id: 'Pb', react: [t('Pb2+', 'aq')], prod: [t('Pb', 's')], n: 2 },
  { id: 'H', react: [t('H+', 'aq', 2)], prod: [t('H2', 'g')], n: 2 },
  { id: 'AgCl', react: [t('AgCl', 's')], prod: [t('Ag', 's'), t('Cl-', 'aq')], n: 1 },
  { id: 'Cu', react: [t('Cu2+', 'aq')], prod: [t('Cu', 's')], n: 2 },
  { id: 'I2', react: [t('I2', 's')], prod: [t('I-', 'aq', 2)], n: 2 },
  { id: 'Fe3', react: [t('Fe3+', 'aq')], prod: [t('Fe2+', 'aq')], n: 1 },
  { id: 'Ag', react: [t('Ag+', 'aq')], prod: [t('Ag', 's')], n: 1 },
  { id: 'Br2', react: [t('Br2', 'l')], prod: [t('Br-', 'aq', 2)], n: 2 },
  { id: 'O2acid', react: [t('O2', 'g'), t('H+', 'aq', 4)], prod: [t('H2O', 'l', 2)], n: 4 },
  { id: 'Cl2', react: [t('Cl2', 'g')], prod: [t('Cl-', 'aq', 2)], n: 2 },
  { id: 'O2base', react: [t('O2', 'g'), t('H2O', 'l', 2)], prod: [t('OH-', 'aq', 4)], n: 4 },
];

/** What is deposited or released at an electrode, for Faraday's laws: the substance, its formula, electrons per unit. */
export interface Product {
  id: string;
  formula: string;
  /** Electrons per formula unit formed (an atom of Cu needs two). */
  n: number;
}

export const PRODUCTS: readonly Product[] = [
  { id: 'Cu', formula: 'Cu', n: 2 },
  { id: 'Ag', formula: 'Ag', n: 1 },
  { id: 'Zn', formula: 'Zn', n: 2 },
  { id: 'Ni', formula: 'Ni', n: 2 },
  { id: 'Pb', formula: 'Pb', n: 2 },
  { id: 'Al', formula: 'Al', n: 3 },
  { id: 'Fe', formula: 'Fe', n: 2 },
  { id: 'Au', formula: 'Au', n: 3 },
  { id: 'H2', formula: 'H2', n: 2 },
  { id: 'O2', formula: 'O2', n: 4 },
  { id: 'Cl2', formula: 'Cl2', n: 2 },
];
