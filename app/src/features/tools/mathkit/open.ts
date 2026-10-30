// Opens the kit window on a tool. The choice is kept with the tools' other choices so a popped-out window opens on
// the same tab, and a window that is already open follows it.
import { openTool } from '../ui/host';
import { loadStored, saveStored, watchStored } from '../ui/storage';

const STORE = 'kitmath.tab';
const EVENT = 'opennote:kitmath-tab';

export const savedMathTab = (): string | null => {
  const saved = loadStored<unknown>(STORE, null);
  return typeof saved === 'string' ? saved : null;
};

export const saveMathTab = (id: string): void => saveStored(STORE, id);

/** Calls `changed` when a command in this window, or another window, picks a tab. */
export function followMathTab(changed: () => void): () => void {
  const stop = watchStored(STORE, changed);
  window.addEventListener(EVENT, changed);
  return () => {
    stop();
    window.removeEventListener(EVENT, changed);
  };
}

export function openMathKit(tool?: string): void {
  if (tool) saveMathTab(tool);
  window.dispatchEvent(new Event(EVENT));
  openTool('kit-math');
}
