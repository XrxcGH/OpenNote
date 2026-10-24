// Standard thermodynamic data at 298.15 K and 1 bar for the species the thermochemistry and electrochemistry tools
// know: enthalpy of formation (kJ/mol), standard molar entropy (J/(mol K)), and, for aqueous ions and a few solids,
// the Gibbs energy of formation (kJ/mol). Other Gibbs energies of formation come from the first two columns and the
// entropies of the elements (see gibbsOfFormation).
//
// The src column names the source of a row.
//   CODATA: Key Values for Thermodynamics (Cox, Wagman, and Medvedev, 1989), published freely.
//   NBS: Tables of Chemical Thermodynamic Properties (Wagman et al., 1982), a US Government publication.
//   NIST: the Chemistry WebBook and NIST-JANAF tables (US Government, public domain), for gases.
// Values are measured facts; the tables are not reproduced, only the numbers for these species.

export type Phase = 'g' | 'l' | 's' | 'aq';
export type DataSource = 'codata' | 'nbs' | 'nist';

export interface Species {
  /** The formula as typed, such as "H2O" or "Cu2+". */
  formula: string;
  phase: Phase;
  /** Enthalpy of formation, kJ/mol. */
  hf: number;
  /** Standard molar entropy, J/(mol K). */
  s: number;
  /** Gibbs energy of formation, kJ/mol, when the table gives one that the other columns do not reproduce. */
  gf?: number;
  src: DataSource;
}

const sp = (formula: string, phase: Phase, hf: number, s: number, src: DataSource, gf?: number): Species =>
  gf === undefined ? { formula, phase, hf, s, src } : { formula, phase, hf, s, gf, src };

export const SPECIES: readonly Species[] = [
  // Elements in their standard states.
  sp('H2', 'g', 0, 130.68, 'codata'),
  sp('N2', 'g', 0, 191.609, 'codata'),
  sp('O2', 'g', 0, 205.152, 'codata'),
  sp('Cl2', 'g', 0, 223.081, 'codata'),
  sp('F2', 'g', 0, 202.791, 'nbs'),
  sp('Br2', 'l', 0, 152.21, 'codata'),
  sp('I2', 's', 0, 116.14, 'codata'),
  sp('C', 's', 0, 5.74, 'codata'),
  sp('S', 's', 0, 32.054, 'codata'),
  sp('He', 'g', 0, 126.153, 'codata'),
  sp('Ne', 'g', 0, 146.328, 'codata'),
  sp('Ar', 'g', 0, 154.846, 'codata'),
  sp('Na', 's', 0, 51.3, 'codata'),
  sp('K', 's', 0, 64.68, 'codata'),
  sp('Mg', 's', 0, 32.67, 'codata'),
  sp('Ca', 's', 0, 41.59, 'codata'),
  sp('Al', 's', 0, 28.3, 'codata'),
  sp('Si', 's', 0, 18.81, 'codata'),
  sp('Fe', 's', 0, 27.28, 'nbs'),
  sp('Cu', 's', 0, 33.15, 'codata'),
  sp('Zn', 's', 0, 41.63, 'codata'),
  sp('Ag', 's', 0, 42.55, 'codata'),
  sp('Pb', 's', 0, 65.06, 'codata'),
  sp('Ni', 's', 0, 29.87, 'nbs'),
  sp('Hg', 'l', 0, 75.9, 'codata'),
  // Water, oxides of carbon, nitrogen, and sulfur.
  sp('H2O', 'l', -285.83, 69.95, 'codata', -237.14),
  sp('H2O', 'g', -241.826, 188.835, 'nist'),
  sp('H2O2', 'l', -187.78, 109.6, 'nbs'),
  sp('CO2', 'g', -393.51, 213.785, 'codata'),
  sp('CO', 'g', -110.53, 197.66, 'codata'),
  sp('NH3', 'g', -45.94, 192.77, 'codata'),
  sp('NO', 'g', 90.29, 210.76, 'nist'),
  sp('NO2', 'g', 33.1, 240.04, 'nist'),
  sp('N2O', 'g', 82.05, 219.85, 'nbs'),
  sp('N2O4', 'g', 9.16, 304.29, 'nbs'),
  sp('O3', 'g', 142.7, 238.93, 'nbs'),
  sp('SO2', 'g', -296.83, 248.22, 'nbs'),
  sp('SO3', 'g', -395.72, 256.76, 'nbs'),
  sp('H2S', 'g', -20.63, 205.79, 'nbs'),
  sp('HCl', 'g', -92.31, 186.902, 'codata'),
  sp('HF', 'g', -273.3, 173.779, 'nbs'),
  sp('HBr', 'g', -36.29, 198.7, 'nbs'),
  sp('HI', 'g', 26.48, 206.59, 'nbs'),
  sp('HNO3', 'l', -174.1, 155.6, 'nbs'),
  sp('H2SO4', 'l', -813.99, 156.9, 'nbs'),
  // Hydrocarbons and fuels.
  sp('CH4', 'g', -74.873, 186.251, 'nist'),
  sp('C2H6', 'g', -84.68, 229.6, 'nbs'),
  sp('C3H8', 'g', -103.85, 270.3, 'nbs'),
  sp('C2H4', 'g', 52.26, 219.56, 'nbs'),
  sp('C2H2', 'g', 226.73, 200.94, 'nbs'),
  sp('C6H6', 'l', 49.0, 173.4, 'nbs'),
  sp('C6H6', 'g', 82.9, 269.2, 'nbs'),
  sp('C8H18', 'l', -249.9, 361.1, 'nbs'),
  sp('CH3OH', 'l', -238.66, 126.8, 'nbs'),
  sp('CH3OH', 'g', -200.66, 239.81, 'nbs'),
  sp('C2H5OH', 'l', -277.69, 160.7, 'nbs'),
  sp('C2H5OH', 'g', -235.1, 282.7, 'nbs'),
  sp('CH3COOH', 'l', -484.5, 159.8, 'nbs'),
  sp('C6H12O6', 's', -1274.4, 212.1, 'nbs'),
  // Salts, oxides, and carbonates.
  sp('NaCl', 's', -411.12, 72.11, 'codata'),
  sp('NaOH', 's', -425.61, 64.46, 'nbs'),
  sp('Na2CO3', 's', -1130.68, 134.98, 'nbs'),
  sp('NaHCO3', 's', -950.81, 101.7, 'nbs'),
  sp('CaO', 's', -635.09, 39.75, 'nbs'),
  sp('Ca(OH)2', 's', -986.09, 83.39, 'nbs'),
  sp('CaCO3', 's', -1206.92, 92.9, 'nbs'),
  sp('CaCl2', 's', -795.8, 104.6, 'nbs'),
  sp('MgO', 's', -601.6, 26.94, 'codata'),
  sp('Mg(OH)2', 's', -924.54, 63.18, 'nbs'),
  sp('Al2O3', 's', -1675.7, 50.92, 'codata'),
  sp('Fe2O3', 's', -824.2, 87.4, 'nbs'),
  sp('Fe3O4', 's', -1118.4, 146.4, 'nbs'),
  sp('CuO', 's', -157.3, 42.63, 'nbs'),
  sp('ZnO', 's', -350.46, 43.64, 'nbs'),
  sp('Ag2O', 's', -31.05, 121.3, 'nbs'),
  sp('AgCl', 's', -127.07, 96.2, 'nbs', -109.79),
  sp('SiO2', 's', -910.94, 41.84, 'nbs'),
  sp('NH4Cl', 's', -314.43, 94.6, 'nbs'),
  sp('NH4NO3', 's', -365.56, 151.08, 'nbs'),
  // Aqueous ions (the hydrogen ion is the zero of enthalpy, entropy, and Gibbs energy).
  sp('H+', 'aq', 0, 0, 'codata', 0),
  sp('OH-', 'aq', -229.99, -10.75, 'nbs', -157.24),
  sp('Na+', 'aq', -240.12, 59.0, 'nbs', -261.91),
  sp('K+', 'aq', -252.38, 102.5, 'nbs', -283.27),
  sp('Cl-', 'aq', -167.16, 56.5, 'nbs', -131.23),
  sp('Br-', 'aq', -121.55, 82.4, 'nbs', -103.96),
  sp('I-', 'aq', -55.19, 111.3, 'nbs', -51.57),
  sp('Cu2+', 'aq', 64.77, -99.6, 'nbs', 65.49),
  sp('Zn2+', 'aq', -153.89, -112.1, 'nbs', -147.06),
  sp('Ag+', 'aq', 105.58, 72.68, 'nbs', 77.107),
  sp('Fe2+', 'aq', -89.1, -137.7, 'nbs', -78.9),
  sp('Fe3+', 'aq', -48.5, -315.9, 'nbs', -4.7),
  sp('Ni2+', 'aq', -54.0, -128.9, 'nbs', -45.6),
  sp('Pb2+', 'aq', -1.7, 10.5, 'nbs', -24.43),
  sp('Mg2+', 'aq', -466.85, -138.1, 'nbs', -454.8),
  sp('Ca2+', 'aq', -542.83, -53.1, 'nbs', -553.58),
  sp('Al3+', 'aq', -531, -321.7, 'nbs', -485),
  sp('NO3-', 'aq', -207.36, 146.4, 'nbs', -111.25),
  sp('SO42-', 'aq', -909.27, 20.1, 'nbs', -744.53),
  sp('CO32-', 'aq', -677.14, -56.9, 'nbs', -527.81),
  sp('HCO3-', 'aq', -691.99, 91.2, 'nbs', -586.77),
  sp('NH4+', 'aq', -132.51, 113.4, 'nbs', -79.31),
];

/** Entropies of the elements in their standard states, J/(mol K) per atom, for computing Gibbs energies of formation. */
const ELEMENT_ENTROPY: Record<string, number> = {
  H: 130.68 / 2,
  N: 191.609 / 2,
  O: 205.152 / 2,
  Cl: 223.081 / 2,
  F: 202.791 / 2,
  Br: 152.21 / 2,
  I: 116.14 / 2,
  C: 5.74,
  S: 32.054,
  Na: 51.3,
  K: 64.68,
  Mg: 32.67,
  Ca: 41.59,
  Al: 28.3,
  Si: 18.81,
  Fe: 27.28,
  Cu: 33.15,
  Zn: 41.63,
  Ag: 42.55,
  Pb: 65.06,
  Ni: 29.87,
  Hg: 75.9,
};

const T0 = 298.15;

/**
 * The Gibbs energy of formation of a species, kJ/mol: the tabulated one when there is one, otherwise
 * dHf - T (S - sum of the entropies of its elements). Null for an ion without a tabulated value or an element
 * whose entropy is not in the table.
 */
export function gibbsOfFormation(species: Species, counts: ReadonlyMap<string, number>): number | null {
  if (species.gf !== undefined) return species.gf;
  if (species.phase === 'aq') return null;
  let elements = 0;
  for (const [symbol, count] of counts) {
    const s = ELEMENT_ENTROPY[symbol];
    if (s === undefined) return null;
    elements += count * s;
  }
  return species.hf - (T0 * (species.s - elements)) / 1000;
}

/** The species for a formula and phase; without a phase, the first listed (the common one, such as liquid water). */
export function findSpecies(formula: string, phase?: Phase): Species | null {
  const key = formula.replace(/\s+/g, '');
  return SPECIES.find((s) => s.formula === key && (phase === undefined || s.phase === phase)) ?? null;
}

export const SOURCE_NAMES: Record<DataSource, string> = {
  codata: 'CODATA Key Values for Thermodynamics (Cox, Wagman, Medvedev, 1989)',
  nbs: 'NBS Tables of Chemical Thermodynamic Properties (Wagman et al., 1982)',
  nist: 'NIST Chemistry WebBook and NIST-JANAF tables',
};
