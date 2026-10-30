// Opens the kit window on a tool. The choice is saved on this device, so a window of its own opens on the same tool,
// and a window that is already open follows it. Nothing heavy loads here.
const PREFIX = 'opennote.tools.kitMechDyn.';
const KEY = `${PREFIX}tab`;
/** Bumped each time a calculation block hands the window its inputs, so a window showing that tool reloads them. */
const RESTORE_KEY = `${PREFIX}restored`;
export const TAB_EVENT = 'opennote:kitmechdyn-tab';

/** The typed texts and units a calculation block saved, to put back in its tool. */
export interface SavedInputs {
  texts: Record<string, string>;
  system: 'si' | 'us';
}

/** Saves a tool's texts and the units where its panel reads them on opening, and marks a restore. */
export function restoreInputs(tool: string, inputs: SavedInputs): void {
  try {
    localStorage.setItem(PREFIX + tool, JSON.stringify(inputs.texts));
    localStorage.setItem(`${PREFIX}system`, JSON.stringify(inputs.system));
    localStorage.setItem(RESTORE_KEY, JSON.stringify(Date.now()));
  } catch {
    // The window still opens on the tool, with the texts it had.
  }
}

/** How many restores this device has seen, to key the tool panel so it reloads. */
export function restoreStamp(): number {
  try {
    const saved = JSON.parse(localStorage.getItem(RESTORE_KEY) ?? '0') as unknown;
    return typeof saved === 'number' ? saved : 0;
  } catch {
    return 0;
  }
}

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
    if (event.key === KEY || event.key === RESTORE_KEY) changed();
  };
  window.addEventListener(TAB_EVENT, changed);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(TAB_EVENT, changed);
    window.removeEventListener('storage', onStorage);
  };
}

export async function openMechDynKit(tool?: string, inputs?: SavedInputs): Promise<void> {
  if (tool) saveTab(tool);
  if (tool && inputs) restoreInputs(tool, inputs);
  window.dispatchEvent(new Event(TAB_EVENT));
  (await import('../../tools')).openTool('kit-mechdyn');
}
