// The chemical and biological reactors tool's calculations. The methods are in ./engine.
import type { Calc } from '../core/types';
import { BIO_CALCS } from './bio';
import { DESIGN_CALCS } from './design';

export const CALCS: readonly Calc[] = [...DESIGN_CALCS, ...BIO_CALCS];
