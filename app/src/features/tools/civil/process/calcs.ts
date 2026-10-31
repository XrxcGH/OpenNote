// The material balances and separations tool's calculations. The methods are in ./engine.
import type { Calc } from '../core/types';
import { BALANCE_CALCS } from './balances';
import { SEPARATION_CALCS } from './separations';

export const CALCS: readonly Calc[] = [...BALANCE_CALCS, ...SEPARATION_CALCS];
