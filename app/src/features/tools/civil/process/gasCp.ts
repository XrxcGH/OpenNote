// Mean molar heat capacities of the ideal gases in the chemistry kit's table, for the energy balance.
import { GAS_ROWS } from '../../chem/data/gasData';
import { gasCp } from '../../chem/data/lookup';
import { need } from '../core/types';

/** The table's gases, numbered from 1 in this order. */
export const GAS_LIST: string = GAS_ROWS.map((r, i) => `${i + 1} ${r[0]} (${r[1]})`).join(', ');

/** Mean cp of gas number `index` between 298.15 K and T, J/(mol·K): the integral of cp dT over the range, by Simpson. */
export function meanGasCp(index: number, T: number): number {
  const row = GAS_ROWS[index - 1];
  need(Number.isInteger(index) && row !== undefined, 'process.errors.gas', { count: GAS_ROWS.length });
  const name = row![0];
  const M = row![2];
  const at = (t: number) => gasCp(name, t);
  need(at(T) !== null, 'process.errors.gasRange');
  const Href = 298.15;
  if (Math.abs(T - Href) < 1e-9) return at(Href)! * M;
  const N = 200;
  const h = (T - Href) / N;
  let sum = at(Href)! + at(T)!;
  for (let i = 1; i < N; i++) sum += (i % 2 ? 4 : 2) * at(Href + i * h)!;
  return ((sum * h) / 3 / (T - Href)) * M;
}
