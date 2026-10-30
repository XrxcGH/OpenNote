// The orbital mechanics tool. Its calculations, in the order the window lists them: orbit basics; state vector to
// elements; elements to state vector; Kepler's equation; propagation; ground track; J2 drift; eclipses.
import type { ToolSpec } from '../kit/types';
import { eclipseMode, j2Mode, trackMode } from './drift';
import { basicsMode, elementsMode, keplerMode, propagateMode, stateMode } from './twobody';

export const ORBITS: ToolSpec = {
  id: 'orbits',
  modes: [basicsMode, stateMode, elementsMode, keplerMode, propagateMode, trackMode, j2Mode, eclipseMode],
};
