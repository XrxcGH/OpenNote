// The aerospace kit's tools, in tab order. The window and the palette registration both read this list; it holds
// no engine code, so the palette can list the tools at start-up without loading them.
import type { IconName } from '../../../ui/icons';

export const AERO_TOOLS = [
  { id: 'atmosphere', icon: 'Mountains' },
  { id: 'compressible', icon: 'Wind' },
  { id: 'nozzle', icon: 'Funnel' },
] as const satisfies readonly {
  id: string;
  icon: IconName;
}[];

export type AeroToolId = (typeof AERO_TOOLS)[number]['id'];

export const isAeroTool = (id: unknown): id is AeroToolId => AERO_TOOLS.some((tool) => tool.id === id);
