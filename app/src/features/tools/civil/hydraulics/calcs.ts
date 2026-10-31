// The hydrology and open channels tool's calculations. The methods are in ./engine.
import type { Calc } from '../core/types';
import { CHANNEL_CALCS } from './channels';
import { HYDROLOGY_CALCS } from './hydrology';

export const CALCS: readonly Calc[] = [...HYDROLOGY_CALCS, ...CHANNEL_CALCS];
