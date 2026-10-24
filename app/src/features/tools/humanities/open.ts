// Which tool the kit window shows. A palette command sets it, then opens the window, so each tool has a command of
// its own while the kit keeps one window.
import { createStore } from '../../../state/store';
import { HUMANITIES_TOOLS } from './meta';
import type { HumanitiesToolId } from './meta';

const KEY = 'opennote.kits.humanities.tool';

function remembered(): HumanitiesToolId {
  try {
    const saved = window.localStorage.getItem(KEY);
    const found = HUMANITIES_TOOLS.find((tool) => tool.id === saved);
    if (found) return found.id;
  } catch {
    // Storage can be blocked; the first tool is shown then.
  }
  return HUMANITIES_TOOLS[0].id;
}

export const shownTool = createStore<HumanitiesToolId>(
  typeof window === 'undefined' ? HUMANITIES_TOOLS[0].id : remembered(),
  'humanities kit tool',
);

export function showTool(id: HumanitiesToolId): void {
  shownTool.set(id);
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    // Remembering the tool is a convenience only.
  }
}

/** Shows this tool in the kit window and opens the window. */
export async function openHumanitiesTool(id: HumanitiesToolId): Promise<void> {
  showTool(id);
  (await import('../ui/host')).openTool('kit-humanities');
}
