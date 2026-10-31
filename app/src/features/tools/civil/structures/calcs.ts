// The indeterminate structures and influence lines tool's calculations. The methods are in ./engine.
import type { Calc } from '../core/types';
import { BEAM_CALCS } from './beams';
import { FRAME_CALCS } from './frames';

export const CALCS: readonly Calc[] = [...BEAM_CALCS, ...FRAME_CALCS];
