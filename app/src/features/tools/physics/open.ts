// Opens the physics tools window on one tool. The tab is kept with the tools' other choices, so a window that opens
// later starts on it and a window that is open already (here or popped out) follows it.
import { openTool } from '../ui/host';
import { loadStored, saveStored, watchStored } from '../ui/storage';

const TAB = 'kit.physics.tab';
const EVENT = 'opennote:physics-tool';

/** The tab the window shows, or null before one was chosen. */
export function savedPhysicsTab(): string | null {
  const saved = loadStored<unknown>(TAB, null);
  return typeof saved === 'string' ? saved : null;
}

export function savePhysicsTab(tool: string): void {
  saveStored(TAB, tool);
}

/** Calls `changed` when a command here or in another window picks a tab. */
export function followPhysicsTab(changed: () => void): () => void {
  const stop = watchStored(TAB, changed);
  window.addEventListener(EVENT, changed);
  return () => {
    stop();
    window.removeEventListener(EVENT, changed);
  };
}

/** Opens the physics tools, on `tool` when one is named. */
export function openPhysicsTool(tool: string | null): void {
  if (tool) {
    savePhysicsTab(tool);
    window.dispatchEvent(new CustomEvent(EVENT));
  }
  openTool('kit-physics');
}
