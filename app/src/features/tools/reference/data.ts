// The reference tables (Productivity and study tools): the periodic table, physical constants, metric prefixes, and
// Greek letters. The data is plain and complete for what it lists, and works offline.
import { CONSTANTS } from '../calculator';

export type ElementGroup =
  | 'alkali'
  | 'alkaline'
  | 'transition'
  | 'post'
  | 'metalloid'
  | 'nonmetal'
  | 'halogen'
  | 'noble'
  | 'lanthanide'
  | 'actinide';

export interface Element {
  number: number;
  symbol: string;
  name: string;
  /** Standard atomic weight, or the mass number of the longest-lived isotope for elements with no stable one. */
  mass: number;
  group: ElementGroup;
}

// number, symbol, name, mass
const ROWS = `1 H Hydrogen 1.008|2 He Helium 4.0026|3 Li Lithium 6.94|4 Be Beryllium 9.0122|5 B Boron 10.81|
6 C Carbon 12.011|7 N Nitrogen 14.007|8 O Oxygen 15.999|9 F Fluorine 18.998|10 Ne Neon 20.180|
11 Na Sodium 22.990|12 Mg Magnesium 24.305|13 Al Aluminium 26.982|14 Si Silicon 28.085|15 P Phosphorus 30.974|
16 S Sulfur 32.06|17 Cl Chlorine 35.45|18 Ar Argon 39.948|19 K Potassium 39.098|20 Ca Calcium 40.078|
21 Sc Scandium 44.956|22 Ti Titanium 47.867|23 V Vanadium 50.942|24 Cr Chromium 51.996|25 Mn Manganese 54.938|
26 Fe Iron 55.845|27 Co Cobalt 58.933|28 Ni Nickel 58.693|29 Cu Copper 63.546|30 Zn Zinc 65.38|
31 Ga Gallium 69.723|32 Ge Germanium 72.630|33 As Arsenic 74.922|34 Se Selenium 78.971|35 Br Bromine 79.904|
36 Kr Krypton 83.798|37 Rb Rubidium 85.468|38 Sr Strontium 87.62|39 Y Yttrium 88.906|40 Zr Zirconium 91.224|
41 Nb Niobium 92.906|42 Mo Molybdenum 95.95|43 Tc Technetium 98|44 Ru Ruthenium 101.07|45 Rh Rhodium 102.91|
46 Pd Palladium 106.42|47 Ag Silver 107.87|48 Cd Cadmium 112.41|49 In Indium 114.82|50 Sn Tin 118.71|
51 Sb Antimony 121.76|52 Te Tellurium 127.60|53 I Iodine 126.90|54 Xe Xenon 131.29|55 Cs Caesium 132.91|
56 Ba Barium 137.33|57 La Lanthanum 138.91|58 Ce Cerium 140.12|59 Pr Praseodymium 140.91|
60 Nd Neodymium 144.24|61 Pm Promethium 145|62 Sm Samarium 150.36|63 Eu Europium 151.96|
64 Gd Gadolinium 157.25|65 Tb Terbium 158.93|66 Dy Dysprosium 162.50|67 Ho Holmium 164.93|68 Er Erbium 167.26|
69 Tm Thulium 168.93|70 Yb Ytterbium 173.05|71 Lu Lutetium 174.97|72 Hf Hafnium 178.49|73 Ta Tantalum 180.95|
74 W Tungsten 183.84|75 Re Rhenium 186.21|76 Os Osmium 190.23|77 Ir Iridium 192.22|78 Pt Platinum 195.08|
79 Au Gold 196.97|80 Hg Mercury 200.59|81 Tl Thallium 204.38|82 Pb Lead 207.2|83 Bi Bismuth 208.98|
84 Po Polonium 209|85 At Astatine 210|86 Rn Radon 222|87 Fr Francium 223|88 Ra Radium 226|89 Ac Actinium 227|
90 Th Thorium 232.04|91 Pa Protactinium 231.04|92 U Uranium 238.03|93 Np Neptunium 237|94 Pu Plutonium 244|
95 Am Americium 243|96 Cm Curium 247|97 Bk Berkelium 247|98 Cf Californium 251|99 Es Einsteinium 252|
100 Fm Fermium 257|101 Md Mendelevium 258|102 No Nobelium 259|103 Lr Lawrencium 266|104 Rf Rutherfordium 267|
105 Db Dubnium 268|106 Sg Seaborgium 269|107 Bh Bohrium 270|108 Hs Hassium 277|109 Mt Meitnerium 278|
110 Ds Darmstadtium 281|111 Rg Roentgenium 282|112 Cn Copernicium 285|113 Nh Nihonium 286|
114 Fl Flerovium 289|115 Mc Moscovium 290|116 Lv Livermorium 293|117 Ts Tennessine 294|118 Og Oganesson 294`;

const ALKALI = new Set([3, 11, 19, 37, 55, 87]);
const ALKALINE = new Set([4, 12, 20, 38, 56, 88]);
const METALLOID = new Set([5, 14, 32, 33, 51, 52]);
const POST = new Set([13, 31, 49, 50, 81, 82, 83, 84, 113, 114, 115, 116]);
const NONMETAL = new Set([1, 6, 7, 8, 15, 16, 34]);
const HALOGEN = new Set([9, 17, 35, 53, 85, 117]);
const NOBLE = new Set([2, 10, 18, 36, 54, 86, 118]);

/** The family an element belongs to, by atomic number. */
export function groupOf(number: number): ElementGroup {
  if (ALKALI.has(number)) return 'alkali';
  if (ALKALINE.has(number)) return 'alkaline';
  if (METALLOID.has(number)) return 'metalloid';
  if (POST.has(number)) return 'post';
  if (NONMETAL.has(number)) return 'nonmetal';
  if (HALOGEN.has(number)) return 'halogen';
  if (NOBLE.has(number)) return 'noble';
  if (number >= 57 && number <= 71) return 'lanthanide';
  if (number >= 89 && number <= 103) return 'actinide';
  return 'transition';
}

export const ELEMENTS: readonly Element[] = ROWS.split(/\|\n?/).map((row) => {
  const [number, symbol, name, mass] = row.split(' ');
  return { number: Number(number), symbol, name, mass: Number(mass), group: groupOf(Number(number)) };
});

export const ELEMENT_GROUPS: readonly ElementGroup[] = [
  'alkali',
  'alkaline',
  'transition',
  'post',
  'metalloid',
  'nonmetal',
  'halogen',
  'noble',
  'lanthanide',
  'actinide',
];

export interface PhysicalConstant {
  name: string;
  symbol: string;
  value: number;
  unit: string;
}

const NAMES: Readonly<Record<string, string>> = {
  c: 'Speed of light in a vacuum',
  g: 'Standard gravity',
  G: 'Gravitational constant',
  h: 'Planck constant',
  hbar: 'Reduced Planck constant',
  kB: 'Boltzmann constant',
  NA: 'Avogadro constant',
  R: 'Molar gas constant',
  qe: 'Elementary charge',
  me: 'Electron mass',
  mp: 'Proton mass',
  eps0: 'Vacuum permittivity',
  mu0: 'Vacuum permeability',
  atm: 'Standard atmosphere',
};

/** The physical constants the calculator knows, with their names. */
export const PHYSICAL_CONSTANTS: readonly PhysicalConstant[] = CONSTANTS.filter(
  (constant) => constant.group === 'physics' && NAMES[constant.name],
).map((constant) => ({
  name: NAMES[constant.name],
  symbol: constant.name,
  value: constant.value,
  unit: constant.unit,
}));

export interface Prefix {
  name: string;
  symbol: string;
  power: number;
}

export const PREFIXES: readonly Prefix[] = [
  ['quetta', 'Q', 30],
  ['ronna', 'R', 27],
  ['yotta', 'Y', 24],
  ['zetta', 'Z', 21],
  ['exa', 'E', 18],
  ['peta', 'P', 15],
  ['tera', 'T', 12],
  ['giga', 'G', 9],
  ['mega', 'M', 6],
  ['kilo', 'k', 3],
  ['hecto', 'h', 2],
  ['deca', 'da', 1],
  ['deci', 'd', -1],
  ['centi', 'c', -2],
  ['milli', 'm', -3],
  ['micro', 'µ', -6],
  ['nano', 'n', -9],
  ['pico', 'p', -12],
  ['femto', 'f', -15],
  ['atto', 'a', -18],
  ['zepto', 'z', -21],
  ['yocto', 'y', -24],
  ['ronto', 'r', -27],
  ['quecto', 'q', -30],
].map(([name, symbol, power]) => ({ name, symbol, power }) as Prefix);

export interface GreekLetter {
  name: string;
  upper: string;
  lower: string;
}

export const GREEK: readonly GreekLetter[] = [
  ['alpha', 'Α', 'α'],
  ['beta', 'Β', 'β'],
  ['gamma', 'Γ', 'γ'],
  ['delta', 'Δ', 'δ'],
  ['epsilon', 'Ε', 'ε'],
  ['zeta', 'Ζ', 'ζ'],
  ['eta', 'Η', 'η'],
  ['theta', 'Θ', 'θ'],
  ['iota', 'Ι', 'ι'],
  ['kappa', 'Κ', 'κ'],
  ['lambda', 'Λ', 'λ'],
  ['mu', 'Μ', 'μ'],
  ['nu', 'Ν', 'ν'],
  ['xi', 'Ξ', 'ξ'],
  ['omicron', 'Ο', 'ο'],
  ['pi', 'Π', 'π'],
  ['rho', 'Ρ', 'ρ'],
  ['sigma', 'Σ', 'σ'],
  ['tau', 'Τ', 'τ'],
  ['upsilon', 'Υ', 'υ'],
  ['phi', 'Φ', 'φ'],
  ['chi', 'Χ', 'χ'],
  ['psi', 'Ψ', 'ψ'],
  ['omega', 'Ω', 'ω'],
].map(([name, upper, lower]) => ({ name, upper, lower }));

/** Whether a row matches what was typed: every word is in its text. */
export function matches(text: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = text.toLowerCase();
  return words.every((word) => hay.includes(word));
}
