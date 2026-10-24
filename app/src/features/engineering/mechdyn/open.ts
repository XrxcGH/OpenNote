// Opens the kit window on a tool. The choice is saved on this device, so a window of its own opens on the same tool,
// and a window that is already open follows it. Nothing heavy loads here.
const KEY = 'opennote.tools.kitMechDyn.tab';
export const TAB_EVENT = 'opennote:kitmechdyn-tab';

export function savedTab(): string | null {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as unknown;
    return typeof saved === 'string' ? saved : null;
  } catch {
    return null;
  }
}

export function saveTab(id: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(id));
  } catch {
    // The window still opens; it just won't remember the tool.
  }
}

/** Calls `changed` when a command here or in another window picks a tool. */
export function followTab(changed: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) changed();
  };
  window.addEventListener(TAB_EVENT, changed);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(TAB_EVENT, changed);
    window.removeEventListener('storage', onStorage);
  };
}

export async function openMechDynKit(tool?: string): Promise<void> {
  if (tool) saveTab(tool);
  window.dispatchEvent(new Event(TAB_EVENT));
  (await import('../../tools')).openTool('kit-mechdyn');
}
