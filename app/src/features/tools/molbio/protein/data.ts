// Amino acid facts for the protein tool: residue formulas, Kyte-Doolittle hydropathy, ionizable group pKa sets, and
// the atomic masses. Published values typed as facts; the property classes are written for this app.
import { ELEMENTS } from '../../reference/data';

export type Element = 'C' | 'H' | 'N' | 'O' | 'S' | 'P';
export type Formula = Partial<Record<Element, number>>;

/** Residue formulas: the amino acid less one water, as it sits in a chain. */
export const RESIDUES: Record<string, Formula> = {
  G: { C: 2, H: 3, N: 1, O: 1 },
  A: { C: 3, H: 5, N: 1, O: 1 },
  S: { C: 3, H: 5, N: 1, O: 2 },
  P: { C: 5, H: 7, N: 1, O: 1 },
  V: { C: 5, H: 9, N: 1, O: 1 },
  T: { C: 4, H: 7, N: 1, O: 2 },
  C: { C: 3, H: 5, N: 1, O: 1, S: 1 },
  L: { C: 6, H: 11, N: 1, O: 1 },
  I: { C: 6, H: 11, N: 1, O: 1 },
  N: { C: 4, H: 6, N: 2, O: 2 },
  D: { C: 4, H: 5, N: 1, O: 3 },
  Q: { C: 5, H: 8, N: 2, O: 2 },
  K: { C: 6, H: 12, N: 2, O: 1 },
  E: { C: 5, H: 7, N: 1, O: 3 },
  M: { C: 5, H: 9, N: 1, O: 1, S: 1 },
  H: { C: 6, H: 7, N: 3, O: 1 },
  F: { C: 9, H: 9, N: 1, O: 1 },
  R: { C: 6, H: 12, N: 4, O: 1 },
  Y: { C: 9, H: 9, N: 1, O: 2 },
  W: { C: 11, H: 10, N: 2, O: 1 },
};

export const AMINO_ACIDS = 'ACDEFGHIKLMNPQRSTVWY';

/** Monoisotopic masses of the most abundant isotopes (NIST, public domain). */
export const MONO: Record<Element, number> = {
  C: 12,
  H: 1.00782503207,
  N: 14.0030740048,
  O: 15.99491461956,
  S: 31.972071,
  P: 30.97376163,
};

/** Standard atomic weights from the app's element table (IUPAC conventional values). */
export const AVERAGE = Object.fromEntries(
  (['C', 'H', 'N', 'O', 'S', 'P'] as const).map((symbol) => [
    symbol,
    ELEMENTS.find((element) => element.symbol === symbol)?.mass ?? NaN,
  ]),
) as Record<Element, number>;

export const PROTON = 1.007276466812;

/** Kyte and Doolittle (1982) hydropathy index. */
export const KYTE_DOOLITTLE: Record<string, number> = {
  A: 1.8,
  R: -4.5,
  N: -3.5,
  D: -3.5,
  C: 2.5,
  Q: -3.5,
  E: -3.5,
  G: -0.4,
  H: -3.2,
  I: 4.5,
  L: 3.8,
  K: -3.9,
  M: 1.9,
  F: 2.8,
  P: -1.6,
  S: -0.8,
  T: -0.7,
  W: -0.9,
  Y: -1.3,
  V: 4.2,
};

/** pKa of the ionizable groups: the termini and the side chains of K, R, H (bases) and D, E, C, Y (acids). */
export interface PkaSet {
  nTerm: number;
  cTerm: number;
  K: number;
  R: number;
  H: number;
  D: number;
  E: number;
  C: number;
  Y: number;
  /** Terminal pKa that depend on the terminal residue (Bjellqvist). */
  nTermBy?: Record<string, number>;
  cTermBy?: Record<string, number>;
}

export const PKA_SETS: Record<'solution' | 'emboss' | 'bjellqvist', PkaSet> = {
  // Free amino acid values from general biochemistry texts.
  solution: { nTerm: 9.69, cTerm: 2.34, K: 10.53, R: 12.48, H: 6.0, D: 3.86, E: 4.25, C: 8.33, Y: 10.07 },
  // The EMBOSS iep defaults.
  emboss: { nTerm: 8.6, cTerm: 3.6, K: 10.8, R: 12.5, H: 6.5, D: 3.9, E: 4.1, C: 8.5, Y: 10.1 },
  // Bjellqvist et al. (1993, 1994), with terminal values that depend on the terminal residue.
  bjellqvist: {
    nTerm: 7.5,
    cTerm: 3.55,
    K: 10.0,
    R: 12.0,
    H: 5.98,
    D: 4.05,
    E: 4.45,
    C: 9.0,
    Y: 10.0,
    nTermBy: { A: 7.59, M: 7.0, S: 6.93, P: 8.36, T: 6.82, V: 7.44, E: 7.7 },
    cTermBy: { D: 4.55, E: 4.75 },
  },
};

/** Molar absorption at 280 nm of W, Y, and cystine (Pace et al., 1995). */
export const EPSILON_280 = { W: 5500, Y: 1490, cystine: 125 };

export type AaClass = 'hydrophobic' | 'polar' | 'positive' | 'negative' | 'special';

/** The side-chain class used for wheels and the reference card. */
export const AA_CLASS: Record<string, AaClass> = {
  A: 'hydrophobic',
  V: 'hydrophobic',
  I: 'hydrophobic',
  L: 'hydrophobic',
  M: 'hydrophobic',
  F: 'hydrophobic',
  W: 'hydrophobic',
  C: 'hydrophobic',
  S: 'polar',
  T: 'polar',
  N: 'polar',
  Q: 'polar',
  Y: 'polar',
  H: 'positive',
  K: 'positive',
  R: 'positive',
  D: 'negative',
  E: 'negative',
  G: 'special',
  P: 'special',
};

/** Mass changes of the modifications, as formulas added (negative counts remove atoms). */
export const MODS: Record<'disulfide' | 'acetyl' | 'amide' | 'phospho', Formula> = {
  disulfide: { H: -2 },
  acetyl: { C: 2, H: 2, O: 1 },
  amide: { O: -1, N: 1, H: 1 },
  phospho: { H: 1, P: 1, O: 3 },
};
