// Opens the earth sciences kit, at one of its tools when a palette command names it.
import { openTool } from '../ui/host';
import type { EarthToolId } from './meta';
import { chooseTool } from './state';

export function openEarthKit(tool?: EarthToolId): void {
  if (tool) chooseTool(tool);
  openTool('kit-earth');
}
