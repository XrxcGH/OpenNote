// Physical constants for the picker and for live math. The values are the 2022 CODATA recommended values (Mohr, Newell,
// Taylor, and Tiesinga, "CODATA recommended values of the fundamental physical constants: 2022", NIST, public
// domain), in SI units. A value is stored as its digits, its power of ten, and its standard uncertainty in the last
// digits (the usual `6.67430(15)`), so the text can be written exactly and nothing is lost to a float. An empty
// `unc` means the value is exact: defined by the SI, or computed from defined values.
//
// This file imports nothing, so the calculator can read it without a cycle.

export type ConstantGroup = 'universal' | 'electromagnetic' | 'atomic' | 'thermodynamic' | 'other';

export interface Codata {
  /** A stable name for the picker's rows and tests. */
  id: string;
  name: string;
  /** The symbol to write in text, such as "kB" or "ε₀". */
  symbol: string;
  /** The symbol in LaTeX, such as "k_\mathrm{B}". */
  latex: string;
  /** The digits of the value, such as "6.67430". */
  mantissa: string;
  exponent: number;
  /** The standard uncertainty in units of the mantissa's last digit, or "" when exact. */
  unc: string;
  /** The unit as text, such as "m³ kg⁻¹ s⁻²". Empty for a pure number. */
  unit: string;
  /** The unit in LaTeX, such as "\mathrm{m^{3}\,kg^{-1}\,s^{-2}}". */
  latexUnit: string;
  group: ConstantGroup;
  /** The name that Math on page lines and the calculator know it by, or "" when there is none. */
  calc: string;
  /** Other words people search by. */
  words: string;
}

const row = (
  id: string,
  name: string,
  symbol: string,
  latex: string,
  value: string,
  unc: string,
  unit: string,
  latexUnit: string,
  group: ConstantGroup,
  calc: string,
  words = '',
): Codata => {
  const [mantissa, power] = value.split('e');
  return {
    id,
    name,
    symbol,
    latex,
    mantissa,
    exponent: power === undefined ? 0 : Number(power),
    unc,
    unit,
    latexUnit,
    group,
    calc,
    words,
  };
};

export const CODATA: readonly Codata[] = [
  row(
    'c',
    'Speed of light in vacuum',
    'c',
    'c',
    '299792458',
    '',
    'm s⁻¹',
    '\\mathrm{m\\,s^{-1}}',
    'universal',
    'c',
    'light lightspeed',
  ),
  row('h', 'Planck constant', 'h', 'h', '6.62607015e-34', '', 'J s', '\\mathrm{J\\,s}', 'universal', 'h', 'quantum'),
  row(
    'hbar',
    'Reduced Planck constant',
    'ħ',
    '\\hbar',
    '1.054571817e-34',
    '',
    'J s',
    '\\mathrm{J\\,s}',
    'universal',
    'hbar',
    'dirac h-bar',
  ),
  row(
    'G',
    'Newtonian constant of gravitation',
    'G',
    'G',
    '6.67430e-11',
    '15',
    'm³ kg⁻¹ s⁻²',
    '\\mathrm{m^{3}\\,kg^{-1}\\,s^{-2}}',
    'universal',
    'G',
    'gravity big g newton',
  ),
  row(
    'g',
    'Standard acceleration of gravity',
    'g',
    'g',
    '9.80665',
    '',
    'm s⁻²',
    '\\mathrm{m\\,s^{-2}}',
    'universal',
    'g',
    'gravity earth free fall little g',
  ),
  row(
    'e',
    'Elementary charge',
    'e',
    'e',
    '1.602176634e-19',
    '',
    'C',
    '\\mathrm{C}',
    'electromagnetic',
    'qe',
    'electron charge proton charge coulomb',
  ),
  row(
    'eps0',
    'Vacuum electric permittivity',
    'ε₀',
    '\\varepsilon_0',
    '8.8541878188e-12',
    '14',
    'F m⁻¹',
    '\\mathrm{F\\,m^{-1}}',
    'electromagnetic',
    'eps0',
    'epsilon naught permittivity of free space',
  ),
  row(
    'mu0',
    'Vacuum magnetic permeability',
    'μ₀',
    '\\mu_0',
    '1.25663706127e-6',
    '20',
    'N A⁻²',
    '\\mathrm{N\\,A^{-2}}',
    'electromagnetic',
    'mu0',
    'mu naught permeability of free space',
  ),
  row(
    'F',
    'Faraday constant',
    'F',
    'F',
    '96485.33212331',
    '',
    'C mol⁻¹',
    '\\mathrm{C\\,mol^{-1}}',
    'electromagnetic',
    'faraday',
    'electrochemistry',
  ),
  row(
    'muB',
    'Bohr magneton',
    'μB',
    '\\mu_\\mathrm{B}',
    '9.2740100657e-24',
    '29',
    'J T⁻¹',
    '\\mathrm{J\\,T^{-1}}',
    'electromagnetic',
    'muB',
    'magneton',
  ),
  row(
    'kB',
    'Boltzmann constant',
    'kB',
    'k_\\mathrm{B}',
    '1.380649e-23',
    '',
    'J K⁻¹',
    '\\mathrm{J\\,K^{-1}}',
    'thermodynamic',
    'kB',
    'boltzmann entropy',
  ),
  row(
    'NA',
    'Avogadro constant',
    'NA',
    'N_\\mathrm{A}',
    '6.02214076e23',
    '',
    'mol⁻¹',
    '\\mathrm{mol^{-1}}',
    'thermodynamic',
    'NA',
    'mole',
  ),
  row(
    'R',
    'Molar gas constant',
    'R',
    'R',
    '8.314462618',
    '',
    'J mol⁻¹ K⁻¹',
    '\\mathrm{J\\,mol^{-1}\\,K^{-1}}',
    'thermodynamic',
    'R',
    'ideal gas universal gas',
  ),
  row(
    'sigma',
    'Stefan-Boltzmann constant',
    'σ',
    '\\sigma',
    '5.670374419e-8',
    '',
    'W m⁻² K⁻⁴',
    '\\mathrm{W\\,m^{-2}\\,K^{-4}}',
    'thermodynamic',
    'sigma',
    'blackbody radiation',
  ),
  row(
    'Vm',
    'Molar volume of an ideal gas (273.15 K, 100 kPa)',
    'Vm',
    'V_\\mathrm{m}',
    '22.71095464e-3',
    '',
    'm³ mol⁻¹',
    '\\mathrm{m^{3}\\,mol^{-1}}',
    'thermodynamic',
    'Vm',
    'stp molar volume',
  ),
  row(
    'atm',
    'Standard atmosphere',
    'atm',
    '\\mathrm{atm}',
    '101325',
    '',
    'Pa',
    '\\mathrm{Pa}',
    'thermodynamic',
    'atm',
    'pressure',
  ),
  row('me', 'Electron mass', 'mₑ', 'm_\\mathrm{e}', '9.1093837139e-31', '28', 'kg', '\\mathrm{kg}', 'atomic', 'me', ''),
  row('mp', 'Proton mass', 'mₚ', 'm_\\mathrm{p}', '1.67262192595e-27', '52', 'kg', '\\mathrm{kg}', 'atomic', 'mp', ''),
  row('mn', 'Neutron mass', 'mₙ', 'm_\\mathrm{n}', '1.67492750056e-27', '85', 'kg', '\\mathrm{kg}', 'atomic', 'mneutron', ''),
  row(
    'u',
    'Atomic mass constant',
    'u',
    'u',
    '1.66053906892e-27',
    '52',
    'kg',
    '\\mathrm{kg}',
    'atomic',
    'amu',
    'dalton amu atomic mass unit',
  ),
  row('a0', 'Bohr radius', 'a₀', 'a_0', '5.29177210544e-11', '82', 'm', '\\mathrm{m}', 'atomic', 'a0', 'hydrogen atom'),
  row(
    'alpha',
    'Fine-structure constant',
    'α',
    '\\alpha',
    '7.2973525643e-3',
    '11',
    '',
    '',
    'atomic',
    'alpha',
    'sommerfeld',
  ),
  row(
    'Rinf',
    'Rydberg constant',
    'R∞',
    'R_\\infty',
    '10973731.568157',
    '12',
    'm⁻¹',
    '\\mathrm{m^{-1}}',
    'atomic',
    'Rinf',
    'spectral lines hydrogen',
  ),
];

const BY_ID = new Map(CODATA.map((one) => [one.id, one]));

export const codataById = (id: string): Codata | undefined => BY_ID.get(id);

/** The value as a float. */
export const codataValue = (one: Codata): number => Number(`${one.mantissa}e${one.exponent}`);

/** The standard uncertainty as a float, or 0 for an exact value. */
export function codataUncertainty(one: Codata): number {
  if (one.unc === '') return 0;
  const decimals = one.mantissa.includes('.') ? one.mantissa.length - one.mantissa.indexOf('.') - 1 : 0;
  return Number(`${one.unc}e${one.exponent - decimals}`);
}

const SUPER = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const sup = (n: number): string =>
  `${n < 0 ? '⁻' : ''}${[...String(Math.abs(n))].map((d) => SUPER[Number(d)]).join('')}`;

/** The value as text with its uncertainty in brackets: `6.67430(15)×10⁻¹¹`, or `6.62607015×10⁻³⁴` when exact. */
export function codataText(one: Codata, withUncertainty = true): string {
  const bracket = withUncertainty && one.unc !== '' ? `(${one.unc})` : '';
  const power = one.exponent === 0 ? '' : `×10${sup(one.exponent)}`;
  return `${one.mantissa}${bracket}${power}`;
}

/** The value in LaTeX: `6.67430(15)\times10^{-11}`. */
export function codataLatex(one: Codata, withUncertainty = true): string {
  const bracket = withUncertainty && one.unc !== '' ? `(${one.unc})` : '';
  const power = one.exponent === 0 ? '' : `\\times10^{${one.exponent}}`;
  return `${one.mantissa}${bracket}${power}`;
}

export type InsertPart = 'symbol' | 'value' | 'both';

/** What to write in text. The value carries its unit. `both` reads `G = 6.67430(15)×10⁻¹¹ m³ kg⁻¹ s⁻²`. */
export function codataInsertText(one: Codata, part: InsertPart): string {
  const value = one.unit === '' ? codataText(one) : `${codataText(one)} ${one.unit}`;
  return part === 'symbol' ? one.symbol : part === 'value' ? value : `${one.symbol} = ${value}`;
}

/** What to write in a math block, as LaTeX. */
export function codataInsertLatex(one: Codata, part: InsertPart): string {
  const value = one.latexUnit === '' ? codataLatex(one) : `${codataLatex(one)}\\,${one.latexUnit}`;
  return part === 'symbol' ? one.latex : part === 'value' ? value : `${one.latex} = ${value}`;
}

/** Searches by name, symbol, live-math name, group, and other words. Every word of the query must match. */
export function searchCodata(query: string, list: readonly Codata[] = CODATA): readonly Codata[] {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '');
  if (words.length === 0) return list;
  return list.filter((one) => {
    const hay = `${one.name} ${one.symbol} ${one.id} ${one.calc} ${one.group} ${one.words} ${one.unit}`.toLowerCase();
    return words.every((word) => hay.includes(word));
  });
}
