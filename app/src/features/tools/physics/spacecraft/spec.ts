// The spacecraft sizing and link budgets tool: propulsion and staging, budgets, power, thermal, attitude
// disturbances, radio links, and RFID read range, in the order the window lists them.
import type { ToolSpec } from '../kit/types';
import { attitudeMode, powerMode, thermalMode } from './environment';
import { linkMode, rfidMode } from './radio';
import { budgetMode, optimalMode, rocketMode, stagingMode } from './rocket';

export const SPACECRAFT: ToolSpec = {
  id: 'spacecraft',
  modes: [rocketMode, stagingMode, optimalMode, budgetMode, powerMode, thermalMode, attitudeMode, linkMode, rfidMode],
};
