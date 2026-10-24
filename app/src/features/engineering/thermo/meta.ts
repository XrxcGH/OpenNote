// The thermodynamics kit's tools: ids, palette titles, keywords, subjects, and icons. Small on purpose: the palette
// registration reads it at start-up, and each tool's engine loads only when its tab opens (kit.ts).
import type { IconName } from '../../../ui/icons';

export const THERMO_TOOL_IDS = ['steam', 'r134a', 'idealgas', 'devices', 'psychro', 'statthermo'] as const;

export type ThermoToolId = (typeof THERMO_TOOL_IDS)[number];

export interface ThermoToolMeta {
  id: ThermoToolId;
  icon: IconName;
  subject: 'thermodynamics' | 'combustion' | 'thermalPhysics';
}

export const THERMO_META: readonly ThermoToolMeta[] = [
  { id: 'steam', icon: 'CloudFog', subject: 'thermodynamics' },
  { id: 'r134a', icon: 'Snowflake', subject: 'thermodynamics' },
  { id: 'idealgas', icon: 'Cylinder', subject: 'thermodynamics' },
  { id: 'devices', icon: 'Fan', subject: 'thermodynamics' },
  { id: 'psychro', icon: 'DropHalf', subject: 'thermodynamics' },
  { id: 'statthermo', icon: 'Atom', subject: 'thermalPhysics' },
];
