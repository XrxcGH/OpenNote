// Opens the life-systems window, optionally at one tool. The request waits in a store, so a window that is already
// open switches tabs and one that opens later starts on the tool that was asked for.
import { createStore } from '../../../state/store';
import { openTool } from '../ui/host';
import type { LifeSysToolId } from './meta';

export const lifeSysRequest = createStore<{ tool: LifeSysToolId | null; at: number }>(
  { tool: null, at: 0 },
  'life-systems tool request',
);

export function openLifeSys(tool?: LifeSysToolId): void {
  if (tool) lifeSysRequest.set({ tool, at: Date.now() });
  openTool('lifesys');
}
