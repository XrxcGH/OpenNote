// The nuclear science tool: decay and activity, decay chains, binding energy, Q-values, attenuation, dose rate with
// distance and shielding, and one-group criticality, in the order the window lists them.
import type { ToolSpec } from '../kit/types';
import { chainMode, decayMode } from './decay';
import { bindingMode, qMode } from './mass';
import { attenuationMode, doseMode, reactorMode } from './shield';

export const NUCLEAR: ToolSpec = {
  id: 'nuclear',
  modes: [decayMode, chainMode, bindingMode, qMode, attenuationMode, doseMode, reactorMode],
};
