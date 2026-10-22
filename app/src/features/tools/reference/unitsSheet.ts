// The units sheet: the SI base and derived units, the 2022 CODATA recommended values of the fundamental constants,
// and common formulas for math, physics, and chemistry. Everything is plain data that works offline. The constants
// are from CODATA 2022 (NIST, public domain), and the units are from the SI brochure (see THIRD_PARTY_NOTICES.md).

export type SheetSection = 'base' | 'derived' | 'constants' | 'math' | 'physics' | 'chemistry';

export const SHEET_SECTIONS: readonly SheetSection[] = ['base', 'derived', 'constants', 'math', 'physics', 'chemistry'];

export interface SheetUnit {
  name: string;
  symbol: string;
  /** What it measures, and for a derived unit, what it is made of. */
  measures: string;
  /** The definition or the combination of base units. */
  definition: string;
}

// name | symbol | quantity | definition (a base unit is defined by fixing a constant; a derived unit by a combination)
export const BASE_UNITS: readonly SheetUnit[] = [
  ['meter', 'm', 'length', 'The distance light travels in a vacuum in 1/299 792 458 of a second.'],
  ['kilogram', 'kg', 'mass', 'Fixed by the Planck constant h = 6.62607015 × 10⁻³⁴ J·s.'],
  ['second', 's', 'time', 'Fixed by the cesium-133 hyperfine frequency, 9 192 631 770 Hz.'],
  ['ampere', 'A', 'electric current', 'Fixed by the elementary charge e = 1.602176634 × 10⁻¹⁹ C.'],
  ['kelvin', 'K', 'thermodynamic temperature', 'Fixed by the Boltzmann constant k = 1.380649 × 10⁻²³ J/K.'],
  ['mole', 'mol', 'amount of substance', 'Exactly 6.02214076 × 10²³ elementary entities.'],
  ['candela', 'cd', 'luminous intensity', 'Fixed by the luminous efficacy of 540 THz light, 683 lm/W.'],
].map(([name, symbol, measures, definition]) => ({ name, symbol, measures, definition }));

export const DERIVED_UNITS: readonly SheetUnit[] = [
  ['radian', 'rad', 'plane angle', 'm/m = 1'],
  ['steradian', 'sr', 'solid angle', 'm²/m² = 1'],
  ['hertz', 'Hz', 'frequency', 's⁻¹'],
  ['newton', 'N', 'force', 'kg·m/s²'],
  ['pascal', 'Pa', 'pressure, stress', 'N/m² = kg/(m·s²)'],
  ['joule', 'J', 'energy, work, heat', 'N·m = kg·m²/s²'],
  ['watt', 'W', 'power', 'J/s = kg·m²/s³'],
  ['coulomb', 'C', 'electric charge', 'A·s'],
  ['volt', 'V', 'electric potential', 'W/A = kg·m²/(s³·A)'],
  ['farad', 'F', 'capacitance', 'C/V = s⁴·A²/(kg·m²)'],
  ['ohm', 'Ω', 'electric resistance', 'V/A = kg·m²/(s³·A²)'],
  ['siemens', 'S', 'electric conductance', 'A/V = Ω⁻¹'],
  ['weber', 'Wb', 'magnetic flux', 'V·s'],
  ['tesla', 'T', 'magnetic flux density', 'Wb/m² = kg/(s²·A)'],
  ['henry', 'H', 'inductance', 'Wb/A = V·s/A'],
  ['degree Celsius', '°C', 'Celsius temperature', 'K − 273.15'],
  ['lumen', 'lm', 'luminous flux', 'cd·sr'],
  ['lux', 'lx', 'illuminance', 'lm/m²'],
  ['becquerel', 'Bq', 'radioactivity', 's⁻¹'],
  ['gray', 'Gy', 'absorbed dose', 'J/kg = m²/s²'],
  ['sievert', 'Sv', 'dose equivalent', 'J/kg = m²/s²'],
  ['katal', 'kat', 'catalytic activity', 'mol/s'],
].map(([name, symbol, measures, definition]) => ({ name, symbol, measures, definition }));

export interface SheetConstant {
  name: string;
  symbol: string;
  value: number;
  unit: string;
  /** True for a value fixed by the 2019 definition of the SI, which has no uncertainty. */
  exact: boolean;
}

// name | symbol | value | unit | exact. CODATA 2022 recommended values; the last digits of the measured ones are uncertain.
export const CODATA_CONSTANTS: readonly SheetConstant[] = [
  ['Speed of light in vacuum', 'c', 299792458, 'm/s', true],
  ['Planck constant', 'h', 6.62607015e-34, 'J·s', true],
  ['Reduced Planck constant', 'ħ', 1.054571817e-34, 'J·s', true],
  ['Elementary charge', 'e', 1.602176634e-19, 'C', true],
  ['Boltzmann constant', 'k', 1.380649e-23, 'J/K', true],
  ['Avogadro constant', 'N_A', 6.02214076e23, '1/mol', true],
  ['Molar gas constant', 'R', 8.314462618, 'J/(mol·K)', true],
  ['Faraday constant', 'F', 96485.33212, 'C/mol', true],
  ['Stefan–Boltzmann constant', 'σ', 5.670374419e-8, 'W/(m²·K⁴)', true],
  ['Wien displacement constant', 'b', 2.897771955e-3, 'm·K', true],
  ['Magnetic flux quantum', 'Φ₀', 2.067833848e-15, 'Wb', true],
  ['Conductance quantum', 'G₀', 7.748091729e-5, 'S', true],
  ['von Klitzing constant', 'R_K', 25812.80745, 'Ω', true],
  ['Standard acceleration of gravity', 'g_n', 9.80665, 'm/s²', true],
  ['Standard atmosphere', 'atm', 101325, 'Pa', true],
  ['Molar volume of an ideal gas (273.15 K, 100 kPa)', 'V_m', 0.022710954641, 'm³/mol', true],
  ['Newtonian constant of gravitation', 'G', 6.6743e-11, 'm³/(kg·s²)', false],
  ['Fine-structure constant', 'α', 7.2973525643e-3, '', false],
  ['Inverse fine-structure constant', '1/α', 137.035999177, '', false],
  ['Vacuum electric permittivity', 'ε₀', 8.8541878188e-12, 'F/m', false],
  ['Vacuum magnetic permeability', 'μ₀', 1.25663706127e-6, 'N/A²', false],
  ['Characteristic impedance of vacuum', 'Z₀', 376.730313412, 'Ω', false],
  ['Electron mass', 'm_e', 9.1093837139e-31, 'kg', false],
  ['Proton mass', 'm_p', 1.67262192595e-27, 'kg', false],
  ['Neutron mass', 'm_n', 1.67492750056e-27, 'kg', false],
  ['Atomic mass constant', 'm_u', 1.66053906892e-27, 'kg', false],
  ['Proton-electron mass ratio', 'm_p/m_e', 1836.152673426, '', false],
  ['Rydberg constant', 'R_∞', 10973731.568157, '1/m', false],
  ['Bohr radius', 'a₀', 5.29177210544e-11, 'm', false],
  ['Classical electron radius', 'r_e', 2.8179403205e-15, 'm', false],
  ['Compton wavelength of the electron', 'λ_C', 2.42631023538e-12, 'm', false],
  ['Bohr magneton', 'μ_B', 9.2740100657e-24, 'J/T', false],
  ['Nuclear magneton', 'μ_N', 5.0507837393e-27, 'J/T', false],
  ['Hartree energy', 'E_h', 4.3597447222e-18, 'J', false],
].map(([name, symbol, value, unit, exact]) => ({ name, symbol, value, unit, exact }) as SheetConstant);

export interface Formula {
  name: string;
  /** The formula as written into a page. */
  text: string;
  /** What the letters stand for. */
  where: string;
}

export const MATH_FORMULAS: readonly Formula[] = [
  ['Quadratic formula', 'x = (−b ± √(b² − 4ac)) / (2a)', 'the roots of ax² + bx + c = 0'],
  ['Pythagorean theorem', 'a² + b² = c²', 'a and b are the legs of a right triangle and c is the hypotenuse'],
  ['Distance between two points', 'd = √((x₂ − x₁)² + (y₂ − y₁)²)', 'the points are (x₁, y₁) and (x₂, y₂)'],
  ['Slope of a line', 'm = (y₂ − y₁) / (x₂ − x₁)', 'the line passes through (x₁, y₁) and (x₂, y₂)'],
  ['Circle: circumference and area', 'C = 2πr, A = πr²', 'r is the radius'],
  ['Sphere: surface area and volume', 'A = 4πr², V = (4/3)πr³', 'r is the radius'],
  ['Cylinder volume', 'V = πr²h', 'r is the radius and h the height'],
  ['Cone volume', 'V = (1/3)πr²h', 'r is the radius of the base and h the height'],
  ['Law of sines', 'a / sin A = b / sin B = c / sin C', 'a, b, c are sides opposite angles A, B, C'],
  ['Law of cosines', 'c² = a² + b² − 2ab cos C', 'C is the angle between sides a and b'],
  ['Arithmetic series', 'S = n(a₁ + aₙ) / 2', 'n terms, first term a₁, last term aₙ'],
  ['Geometric series', 'S = a(1 − rⁿ) / (1 − r)', 'first term a, ratio r, n terms'],
  ['Compound interest', 'A = P(1 + r/n)^(nt)', 'principal P, rate r, n times a year, t years'],
  ['Power rule (derivative)', 'd/dx xⁿ = n·xⁿ⁻¹', 'n is any real number'],
  ['Product rule', "(f·g)' = f'·g + f·g'", 'f and g are differentiable functions'],
  ['Chain rule', "d/dx f(g(x)) = f'(g(x))·g'(x)", 'f and g are differentiable functions'],
  ['Power rule (integral)', '∫ xⁿ dx = xⁿ⁺¹ / (n + 1) + C', 'n ≠ −1'],
  ['Euler identity', 'e^(iπ) + 1 = 0', 'i is the imaginary unit'],
  ['Binomial theorem', '(x + y)ⁿ = Σ C(n, k) xⁿ⁻ᵏ yᵏ', 'the sum is over k = 0 to n'],
  ['Standard deviation', 'σ = √(Σ(xᵢ − μ)² / N)', 'N values with mean μ'],
].map(([name, text, where]) => ({ name, text, where }));

export const PHYSICS_FORMULAS: readonly Formula[] = [
  ['Speed', 'v = d / t', 'distance d over time t'],
  ['Acceleration', 'a = (v − v₀) / t', 'change of velocity over time'],
  ['Position with constant acceleration', 'x = x₀ + v₀t + ½at²', 'starting position x₀, starting velocity v₀'],
  ['Velocity with constant acceleration', 'v² = v₀² + 2a(x − x₀)', 'starting velocity v₀'],
  ["Newton's second law", 'F = m·a', 'force F, mass m, acceleration a'],
  ['Weight', 'W = m·g', 'g = 9.80665 m/s²'],
  ['Momentum', 'p = m·v', 'mass m and velocity v'],
  ['Work', 'W = F·d·cos θ', 'θ is the angle between force and motion'],
  ['Kinetic energy', 'KE = ½mv²', 'mass m and speed v'],
  ['Gravitational potential energy', 'PE = m·g·h', 'height h'],
  ['Power', 'P = W / t', 'work W over time t'],
  ['Centripetal acceleration', 'a = v² / r', 'speed v on a circle of radius r'],
  ["Newton's law of gravitation", 'F = G·m₁·m₂ / r²', 'G is the gravitational constant'],
  ["Hooke's law", 'F = −k·x', 'spring constant k and stretch x'],
  ['Pendulum period', 'T = 2π√(L / g)', 'length L'],
  ['Wave speed', 'v = f·λ', 'frequency f and wavelength λ'],
  ["Snell's law", 'n₁ sin θ₁ = n₂ sin θ₂', 'n is the index of refraction'],
  ['Mass-energy equivalence', 'E = m·c²', 'c is the speed of light'],
  ["Ohm's law", 'V = I·R', 'voltage V, current I, resistance R'],
  ['Electric power', 'P = V·I', 'voltage V and current I'],
  ["Coulomb's law", 'F = k·q₁·q₂ / r²', 'k = 8.9875517923 × 10⁹ N·m²/C²'],
  ['Capacitor energy', 'E = ½CV²', 'capacitance C and voltage V'],
  ['Photon energy', 'E = h·f', 'h is the Planck constant and f the frequency'],
  ['Ideal gas law', 'P·V = n·R·T', 'amount n in moles, temperature T in kelvin'],
  ['Pressure', 'P = F / A', 'force F over area A'],
  ['Heat', 'Q = m·c·ΔT', 'specific heat c and temperature change ΔT'],
].map(([name, text, where]) => ({ name, text, where }));

export const CHEMISTRY_FORMULAS: readonly Formula[] = [
  ['Amount of substance', 'n = m / M', 'mass m over molar mass M'],
  ['Molarity', 'M = n / V', 'moles of solute n per liter of solution V'],
  ['Dilution', 'M₁V₁ = M₂V₂', 'concentration and volume before and after'],
  ['Density', 'ρ = m / V', 'mass m over volume V'],
  ['Ideal gas law', 'P·V = n·R·T', 'R = 8.314462618 J/(mol·K)'],
  ["Boyle's law", 'P₁V₁ = P₂V₂', 'constant temperature and amount'],
  ["Charles's law", 'V₁ / T₁ = V₂ / T₂', 'constant pressure and amount; T in kelvin'],
  ['Combined gas law', 'P₁V₁ / T₁ = P₂V₂ / T₂', 'T in kelvin'],
  ["Dalton's law", 'P_total = P₁ + P₂ + …', 'partial pressures of the gases in a mixture'],
  ['pH', 'pH = −log₁₀[H⁺]', 'hydrogen ion concentration in mol/L'],
  ['pOH and water', 'pH + pOH = 14', 'at 25 °C'],
  ['Henderson–Hasselbalch equation', 'pH = pKa + log₁₀([A⁻] / [HA])', 'conjugate base [A⁻] and acid [HA]'],
  ['Equilibrium constant', 'K = [C]^c [D]^d / ([A]^a [B]^b)', 'for aA + bB ⇌ cC + dD'],
  ['Gibbs free energy', 'ΔG = ΔH − T·ΔS', 'enthalpy ΔH, entropy ΔS, temperature T in kelvin'],
  ['Heat of a reaction', 'q = m·c·ΔT', 'specific heat c and temperature change ΔT'],
  ['Percent yield', '% yield = actual / theoretical × 100', 'both in the same units'],
  ['Percent composition', '% element = (mass of element / mass of compound) × 100', 'the masses in the same units'],
  ['Beer–Lambert law', 'A = ε·l·c', 'molar absorptivity ε, path length l, concentration c'],
  ['Nernst equation', 'E = E° − (R·T / (n·F)) ln Q', 'n electrons, Faraday constant F'],
  ['Arrhenius equation', 'k = A·e^(−Eₐ / (R·T))', 'activation energy Eₐ'],
  ['First-order rate law', '[A] = [A]₀ e^(−kt)', 'rate constant k'],
  ['Half-life (first order)', 't½ = ln 2 / k', 'rate constant k'],
  ['Osmotic pressure', 'Π = i·M·R·T', 'van ’t Hoff factor i'],
  ['Boiling point elevation', 'ΔT_b = i·K_b·m', 'molality m'],
].map(([name, text, where]) => ({ name, text, where }));

const FORMULAS: Readonly<Record<'math' | 'physics' | 'chemistry', readonly Formula[]>> = {
  math: MATH_FORMULAS,
  physics: PHYSICS_FORMULAS,
  chemistry: CHEMISTRY_FORMULAS,
};

/** The formulas of a field of study. */
export const formulasFor = (field: 'math' | 'physics' | 'chemistry'): readonly Formula[] => FORMULAS[field];

const DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const superscript = (exponent: number): string =>
  [...String(Math.abs(exponent))].map((digit) => DIGITS[Number(digit)]).join('');

/** A number in scientific notation when JavaScript writes it that way: 6.62607015 × 10⁻³⁴. */
export function scientific(value: number): string {
  const [mantissa, exponent] = String(value).split('e');
  if (exponent === undefined) return String(value);
  const power = Number(exponent);
  return `${mantissa} × 10${power < 0 ? '⁻' : ''}${superscript(power)}`;
}

/** A constant as a line of text for a page: "h = 6.62607015 × 10⁻³⁴ J·s". */
export function constantLine(constant: SheetConstant): string {
  return `${constant.symbol} = ${scientific(constant.value)}${constant.unit ? ` ${constant.unit}` : ''}`;
}

export interface SheetResult {
  base: readonly SheetUnit[];
  derived: readonly SheetUnit[];
  constants: readonly SheetConstant[];
  math: readonly Formula[];
  physics: readonly Formula[];
  chemistry: readonly Formula[];
}

const words = (query: string): string[] => query.toLowerCase().split(/\s+/).filter(Boolean);
const hasAll = (text: string, query: string): boolean => {
  const hay = text.toLowerCase();
  return words(query).every((word) => hay.includes(word));
};

/** The rows of the sheet that match every word typed, in the chosen section or in all of them. */
export function searchSheet(query: string, section: SheetSection | 'all'): SheetResult {
  const keep = <T>(name: SheetSection, rows: readonly T[], text: (row: T) => string): readonly T[] =>
    section === 'all' || section === name ? rows.filter((row) => hasAll(text(row), query)) : [];
  const unitText = (unit: SheetUnit) => `${unit.name} ${unit.symbol} ${unit.measures} ${unit.definition}`;
  const formulaText = (formula: Formula) => `${formula.name} ${formula.text} ${formula.where}`;
  return {
    base: keep('base', BASE_UNITS, unitText),
    derived: keep('derived', DERIVED_UNITS, unitText),
    constants: keep('constants', CODATA_CONSTANTS, (one) => `${one.name} ${one.symbol} ${one.unit}`),
    math: keep('math', MATH_FORMULAS, formulaText),
    physics: keep('physics', PHYSICS_FORMULAS, formulaText),
    chemistry: keep('chemistry', CHEMISTRY_FORMULAS, formulaText),
  };
}

/** How many rows a search found. */
export const countSheet = (result: SheetResult): number =>
  SHEET_SECTIONS.reduce((total, section) => total + result[section].length, 0);
