// Where the kits meet. Each kit registers how to open its window on a tool (from its registration file, at start-up),
// and a live calculation block on a page asks here to reopen its tool with the inputs it saved. The inputs travel
// through this device's storage as well as an event, so a kit window that is popped out into its own window gets them
// too. Nothing heavy loads here.

/** The subject kits. A kit may register under another id; these are the ones the plan names. */
export type KitId =
  | 'thermo'
  | 'aero'
  | 'fluidheat'
  | 'solids'
  | 'mechdyn'
  | 'control'
  | 'electrical'
  | 'physics'
  | 'math'
  | 'chemmat'
  | 'design'
  | 'statinfer';

/** Opens a kit's window on one of its tools. */
export type KitOpener = (tool: string) => void | Promise<void>;

/** Inputs waiting for a tool: written when a block asks to reopen it, taken once by the tool. */
export interface PendingInputs {
  kit: string;
  tool: string;
  inputs: unknown;
}

export const KIT_INPUTS_EVENT = 'opennote:kit-inputs';
const PENDING_KEY = 'opennote.kits.pending';

const openers = new Map<string, KitOpener>();

/** Registers how to open a kit's window on a tool. A second registration under the same id replaces the first. */
export function registerKit(kit: string, open: KitOpener): void {
  openers.set(kit, open);
}

export const hasKit = (kit: string): boolean => openers.has(kit);

function readPending(): PendingInputs | null {
  try {
    const saved = JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null') as unknown;
    if (!saved || typeof saved !== 'object') return null;
    const { kit, tool, inputs } = saved as Partial<PendingInputs>;
    return typeof kit === 'string' && typeof tool === 'string' ? { kit, tool, inputs: inputs ?? null } : null;
  } catch {
    return null;
  }
}

function writePending(pending: PendingInputs | null): void {
  try {
    if (pending) localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    // Storage can be off; the event below still reaches a window in this process.
  }
}

let latest: PendingInputs | null = null;

/**
 * Opens `tool` in `kit` with `inputs`, as a live calculation block's Open in tool button does. False when no kit
 * of that id is registered (the block came from a newer version, or the kit's flag is off).
 */
export async function openKitTool(kit: string, tool: string, inputs?: unknown): Promise<boolean> {
  const open = openers.get(kit);
  if (!open) return false;
  if (inputs !== undefined) {
    latest = { kit, tool, inputs };
    writePending(latest);
    window.dispatchEvent(new CustomEvent<PendingInputs>(KIT_INPUTS_EVENT, { detail: latest }));
  }
  await open(tool);
  return true;
}

/** The inputs waiting for `tool` of `kit`, removed as they are taken; null when none are. */
export function takeKitInputs(kit: string, tool: string): unknown {
  const pending = latest ?? readPending();
  if (!pending || pending.kit !== kit || pending.tool !== tool) return null;
  latest = null;
  writePending(null);
  return pending.inputs;
}

/** Calls `arrived` when inputs for a tool of `kit` arrive, from this window or another one. */
export function onKitInputs(kit: string, arrived: (tool: string) => void): () => void {
  const onEvent = (event: Event) => {
    const detail = (event as CustomEvent<PendingInputs>).detail;
    if (detail?.kit === kit) arrived(detail.tool);
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== PENDING_KEY) return;
    const pending = readPending();
    if (pending?.kit === kit) arrived(pending.tool);
  };
  window.addEventListener(KIT_INPUTS_EVENT, onEvent);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(KIT_INPUTS_EVENT, onEvent);
    window.removeEventListener('storage', onStorage);
  };
}

export const KIT_TAB_EVENT = 'opennote:kit-tab';
const tabKey = (kit: string): string => `opennote.kits.${kit}.tab`;

/** The tool a kit window shows, as last chosen here or in another window; null before the first choice. */
export function savedKitTab(kit: string): string | null {
  try {
    const saved = JSON.parse(localStorage.getItem(tabKey(kit)) ?? 'null') as unknown;
    return typeof saved === 'string' ? saved : null;
  } catch {
    return null;
  }
}

/** Chooses the tool a kit window shows. A window that is open follows at once; one opened later starts there. */
export function selectKitTab(kit: string, tool: string): void {
  try {
    localStorage.setItem(tabKey(kit), JSON.stringify(tool));
  } catch {
    // The open window still follows the event; a new one starts on its first tool.
  }
  window.dispatchEvent(new CustomEvent<{ kit: string; tool: string }>(KIT_TAB_EVENT, { detail: { kit, tool } }));
}

/** Calls `changed` with the tool when a command here or in another window chooses one for `kit`. */
export function onKitTab(kit: string, changed: (tool: string) => void): () => void {
  const onEvent = (event: Event) => {
    const detail = (event as CustomEvent<{ kit: string; tool: string }>).detail;
    if (detail?.kit === kit) changed(detail.tool);
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== tabKey(kit)) return;
    const tool = savedKitTab(kit);
    if (tool) changed(tool);
  };
  window.addEventListener(KIT_TAB_EVENT, onEvent);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(KIT_TAB_EVENT, onEvent);
    window.removeEventListener('storage', onStorage);
  };
}

/** For tests: forgets every registration and waiting input. */
export function resetKits(): void {
  openers.clear();
  latest = null;
  writePending(null);
}
