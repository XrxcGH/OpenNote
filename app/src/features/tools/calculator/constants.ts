// Named constants. Physical values are the 2019 SI definitions or the 2018 CODATA recommended values, in SI units.
// Names are case-sensitive, so "G" (gravitation) and "g" (standard gravity) differ. The elementary charge is "qe"
// because "e" is Euler's number.

export interface Constant {
  name: string;
  value: number;
  /** The unit of the value in SI base units, such as "m/s". Empty for pure numbers. */
  unit: string;
  group: 'math' | 'physics';
}

export const CONSTANTS: readonly Constant[] = [
  { name: 'pi', value: Math.PI, unit: '', group: 'math' },
  { name: 'e', value: Math.E, unit: '', group: 'math' },
  { name: 'tau', value: 2 * Math.PI, unit: '', group: 'math' },
  { name: 'phi', value: (1 + Math.sqrt(5)) / 2, unit: '', group: 'math' },
  { name: 'c', value: 299792458, unit: 'm/s', group: 'physics' },
  { name: 'g', value: 9.80665, unit: 'm/s²', group: 'physics' },
  { name: 'G', value: 6.6743e-11, unit: 'm³/(kg·s²)', group: 'physics' },
  { name: 'h', value: 6.62607015e-34, unit: 'J·s', group: 'physics' },
  { name: 'hbar', value: 1.054571817e-34, unit: 'J·s', group: 'physics' },
  { name: 'kB', value: 1.380649e-23, unit: 'J/K', group: 'physics' },
  { name: 'NA', value: 6.02214076e23, unit: '1/mol', group: 'physics' },
  { name: 'R', value: 8.314462618, unit: 'J/(mol·K)', group: 'physics' },
  { name: 'qe', value: 1.602176634e-19, unit: 'C', group: 'physics' },
  { name: 'me', value: 9.1093837015e-31, unit: 'kg', group: 'physics' },
  { name: 'mp', value: 1.67262192369e-27, unit: 'kg', group: 'physics' },
  { name: 'eps0', value: 8.8541878128e-12, unit: 'F/m', group: 'physics' },
  { name: 'mu0', value: 1.25663706212e-6, unit: 'N/A²', group: 'physics' },
  { name: 'atm', value: 101325, unit: 'Pa', group: 'physics' },
];

const BY_NAME = new Map(CONSTANTS.map((c) => [c.name, c]));
BY_NAME.set('PI', BY_NAME.get('pi') as Constant);
BY_NAME.set('E', BY_NAME.get('e') as Constant);

/** The constant with this name, or undefined. */
export function findConstant(name: string): Constant | undefined {
  return BY_NAME.get(name);
}
