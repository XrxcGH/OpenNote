// Opens the modern physics window on one tool, or brings it forward showing that tool.
import { openTool } from '../ui/host';
import { MODPHYS_WINDOW } from './meta';
import type { ModPhysToolId } from './meta';
import { showTool } from './request';

export function openModPhys(tool: ModPhysToolId): void {
  showTool(tool);
  openTool(MODPHYS_WINDOW);
}
