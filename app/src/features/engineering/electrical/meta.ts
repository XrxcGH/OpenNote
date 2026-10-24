// The tools of the electrical kit, in tab order. The window and the palette registration both read this list.
import type { IconName } from '../../../ui/icons';

export const ELECTRICAL_TOOLS = [
  { id: 'transients', icon: 'Lightning' },
  { id: 'instruments', icon: 'Gauge' },
  { id: 'acpower', icon: 'Lightning' },
  { id: 'opamps', icon: 'Function' },
  { id: 'semis', icon: 'Circuitry' },
  { id: 'powerflow', icon: 'TreeStructure' },
  { id: 'labfit', icon: 'ChartLine' },
  { id: 'energy', icon: 'Leaf' },
] as const satisfies readonly {
  id: string;
  icon: IconName;
}[];

export type ElectricalToolId = (typeof ELECTRICAL_TOOLS)[number]['id'];
