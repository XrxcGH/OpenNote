// The tool the modern physics window shows. A palette command sets it before opening the window; the window sets
// it when the person picks another, and remembers it for next time.
import { createStore } from '../../../state/store';
import { loadStored, saveStored } from '../ui/storage';
import { isModPhysTool } from './meta';
import type { ModPhysToolId } from './meta';

const KEY = 'modphys.tool';

const remembered = (): ModPhysToolId => {
  const saved = loadStored<unknown>(KEY, 'plasma');
  return isModPhysTool(saved) ? saved : 'plasma';
};

export const shownTool = createStore<ModPhysToolId>(remembered(), 'modern physics tool');

export function showTool(tool: ModPhysToolId): void {
  shownTool.set(tool);
  saveStored(KEY, tool);
}
