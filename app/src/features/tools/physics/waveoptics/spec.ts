// The interference, diffraction, and polarization tool: its calculations, in the order the window lists them.
import type { ToolSpec } from '../kit/types';
import { filmMode, fresnelMode, jonesMode, malusMode } from './polar';
import { circularMode, doubleMode, gratingMode, singleMode } from './slits';

export const WAVE_OPTICS: ToolSpec = {
  id: 'waveoptics',
  modes: [doubleMode, singleMode, gratingMode, circularMode, filmMode, malusMode, fresnelMode, jonesMode],
};
