// Named constants. Physical values are the 2022 CODATA recommended values (features/tools/science/codata.ts), in SI units.
// Names are case-sensitive, so "G" (gravitation) and "g" (standard gravity) differ. The elementary charge is "qe"
// because "e" is Euler's number.

import { CODATA, codataValue } from '../science/codata';

export interface Constant {
  name: string;
  value: number;
  /** The unit of the value in SI base units, such as "m/s". Empty for pure numbers. */
  unit: string;
  group: 'math' | 'physics';
}

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';

/** `m³ kg⁻¹ s⁻²` as `m³/(kg·s²)`: the form the calculator lists units in. */
function slashed(unit: string): string {
  const top: string[] = [];
  const bottom: string[] = [];
  for (const part of unit.split(' ').filter((one) => one !== '')) {
    const at = part.indexOf('⁻');
    if (at < 0) top.push(part);
    else {
      const power = [...part.slice(at + 1)].filter((ch) => SUPERSCRIPT.includes(ch)).join('');
      bottom.push(part.slice(0, at) + (power === '¹' ? '' : power));
    }
  }
  const over = bottom.length > 1 ? `(${bottom.join('·')})` : bottom.join('');
  if (bottom.length === 0) return top.join('·');
  return `${top.length === 0 ? '1' : top.join('·')}/${over}`;
}

export const CONSTANTS: readonly Constant[] = [
  { name: 'pi', value: Math.PI, unit: '', group: 'math' },
  { name: 'e', value: Math.E, unit: '', group: 'math' },
  { name: 'tau', value: 2 * Math.PI, unit: '', group: 'math' },
  { name: 'phi', value: (1 + Math.sqrt(5)) / 2, unit: '', group: 'math' },
  ...CODATA.filter((one) => one.calc !== '').map((one): Constant => ({
    name: one.calc,
    value: codataValue(one),
    unit: slashed(one.unit),
    group: 'physics',
  })),
];

const BY_NAME = new Map(CONSTANTS.map((c) => [c.name, c]));
BY_NAME.set('PI', BY_NAME.get('pi') as Constant);
BY_NAME.set('E', BY_NAME.get('e') as Constant);

/** The constant with this name, or undefined. */
export function findConstant(name: string): Constant | undefined {
  return BY_NAME.get(name);
}
