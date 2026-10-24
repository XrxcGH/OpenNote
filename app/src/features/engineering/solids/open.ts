// Opens the kit window on a tool. The choice is saved with the tool windows' other choices, so a window of its own
// opens on the same tool, and a window that is already open follows it. Nothing heavy loads here.
const KEY = 'opennote.tools.kitSolids.tab';
export const TAB_EVENT = 'opennote:kitsolids-tab';

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
    // The window still opens; it just will not remember the tool.
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

export async function openSolidsKit(tool?: string): Promise<void> {
  if (tool) saveTab(tool);
  window.dispatchEvent(new Event(TAB_EVENT));
  (await import('../../tools')).openTool('kit-solids');
}

/** A live calculation kept in a page: the tool, what was typed, the unit system, and its answer. */
export interface KitCalcData {
  readonly tool: string;
  readonly texts: Readonly<Record<string, string>>;
  readonly system: 'si' | 'us';
  readonly summary: string;
  readonly latex: string;
}

/** Asks the page to insert a live calculation block; the page's listener sets `handled`. */
export const CALC_EVENT = 'opennote:kitsolids-calc';
export interface KitCalcRequest {
  readonly data: KitCalcData;
  readonly fallback: string;
  handled: boolean;
}

/** Tells an open tool that its typed texts were replaced from a page's live calculation. */
export const RESTORE_EVENT = 'opennote:kitsolids-restore';
const PREFIX = 'opennote.tools.kitSolids.';

/** A block's data as a live calculation, or null when it is not one. */
export function readCalc(data: Readonly<Record<string, unknown>>): KitCalcData | null {
  const { tool, texts, system, summary, latex } = data;
  if (typeof tool !== 'string' || (system !== 'si' && system !== 'us')) return null;
  if (typeof texts !== 'object' || texts === null) return null;
  const typed = Object.entries(texts as Record<string, unknown>).filter(([, v]) => typeof v === 'string');
  return {
    tool,
    texts: Object.fromEntries(typed) as Record<string, string>,
    system,
    summary: typeof summary === 'string' ? summary : '',
    latex: typeof latex === 'string' ? latex : '',
  };
}

/** Opens the tool with the texts and unit system a live calculation kept. */
export async function reopenCalc(calc: KitCalcData): Promise<void> {
  try {
    localStorage.setItem(PREFIX + calc.tool, JSON.stringify(calc.texts));
    localStorage.setItem(`${PREFIX}system`, JSON.stringify(calc.system));
  } catch {
    // The tool still opens, on what it last had.
  }
  window.dispatchEvent(new CustomEvent(RESTORE_EVENT, { detail: calc.tool }));
  await openSolidsKit(calc.tool);
}

/** Calls `restored` when a live calculation puts its texts back into `tool`. */
export function followRestore(tool: string, restored: () => void): () => void {
  const on = (event: Event) => {
    if ((event as CustomEvent<string>).detail === tool) restored();
  };
  window.addEventListener(RESTORE_EVENT, on);
  return () => window.removeEventListener(RESTORE_EVENT, on);
}

/** The block's fallback: the answer line, then each typed value, so search and exports keep the numbers. */
export function calcFallback(summary: string, texts: Readonly<Record<string, string>>): string {
  const typed = Object.entries(texts)
    .filter(([, text]) => text.trim() !== '')
    .map(([id, text]) => `${id} = ${text.replace(/\s*\n\s*/g, '; ')}`);
  return [summary, ...typed].join('\n');
}
