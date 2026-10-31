// The earth pressure, foundations, and slopes tool's calculations. The methods are in ./engine.
import type { Calc } from '../core/types';
import { bearingCalc } from './footings';
import { groupCalc, pileCalc } from './piles';
import { coulombCalc, rankineCalc, wallCalc } from './pressure';
import { infiniteCalc, planarCalc, slicesCalc } from './slopes';

export const CALCS: readonly Calc[] = [
  rankineCalc,
  coulombCalc,
  wallCalc,
  bearingCalc,
  infiniteCalc,
  planarCalc,
  slicesCalc,
  pileCalc,
  groupCalc,
];
