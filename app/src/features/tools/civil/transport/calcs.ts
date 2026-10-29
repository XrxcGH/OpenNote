// The traffic, highways, surveying, and site planning tool's calculations. The methods are in ./engine.
import type { Calc } from '../core/types';
import { PLANNING_CALCS } from './planning';
import { TRAFFIC_CALCS } from './traffic';

export const CALCS: readonly Calc[] = [...TRAFFIC_CALCS, ...PLANNING_CALCS];
