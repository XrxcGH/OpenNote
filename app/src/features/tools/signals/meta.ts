// The tools in the signals and sound kit: each one's id, its words in the strings, and its icon. The palette
// commands and the kit's tool list are both made from this list. Loads at start-up, so it holds no tool code.
import type { MessageKey } from '../../../strings/t';

export type SignalToolId =
  'spectrum' | 'filters' | 'systems' | 'neurodata' | 'images' | 'medimaging' | 'audio' | 'comms' | 'rf';

export interface SignalToolMeta {
  readonly id: SignalToolId;
  readonly title: MessageKey;
  readonly open: MessageKey;
  readonly keywords: MessageKey;
  readonly about: MessageKey;
  readonly icon: string;
}

const meta = (id: SignalToolId, icon: string): SignalToolMeta => ({
  id,
  title: `kitSignals.tools.${id}.title`,
  open: `kitSignals.tools.${id}.open`,
  keywords: `kitSignals.tools.${id}.keywords`,
  about: `kitSignals.tools.${id}.about`,
  icon,
});

export const SIGNAL_TOOLS: readonly SignalToolMeta[] = [
  meta('spectrum', 'WaveSine'),
  meta('filters', 'Funnel'),
  meta('systems', 'Sigma'),
  meta('neurodata', 'Heartbeat'),
  meta('images', 'Image'),
  meta('medimaging', 'Scan'),
  meta('audio', 'Waveform'),
  meta('comms', 'Binary'),
  meta('rf', 'Broadcast'),
];

export const isSignalToolId = (value: unknown): value is SignalToolId => SIGNAL_TOOLS.some((tool) => tool.id === value);

/** Where the kit keeps the tool it last showed, so a palette command can open the window at a given tool. */
export const CHOSEN_KEY = 'opennote.kitSignals.tool';
/** Sent in the window when a command picks a tool while the kit is already open. */
export const CHOOSE_EVENT = 'opennote:kit-signals-choose';

/** Remembers the tool to show and tells an open kit to show it. */
export function chooseSignalTool(id: SignalToolId): void {
  try {
    window.localStorage.setItem(CHOSEN_KEY, id);
  } catch {
    // Storage can be off; the open kit still hears the event.
  }
  window.dispatchEvent(new CustomEvent(CHOOSE_EVENT, { detail: id }));
}

/** The kit's id in a live calculation block (KitCalcData.kit). */
export const SIGNALS_KIT = 'signals';
/** Where each tool keeps its fields on this device: STORE_PREFIX + '<tool>.<part>'. */
export const STORE_PREFIX = 'opennote.kitSignals.';
/** Sent in the window when a live calculation block has put a tool's fields back, so an open tool reads them. */
export const RESTORE_EVENT = 'opennote:kit-signals-restore';

/** Whether a saved part ('rf.load', or 'spectrum' for a tool with one part) belongs to `tool`. */
const partOf = (tool: string, part: string): boolean => part === tool || part.startsWith(`${tool}.`);

/** A tool's saved fields, part by part ('rf.load' and so on): what a live calculation block keeps as its inputs. */
export function signalInputs(tool: SignalToolId): Record<string, unknown> {
  const parts: Record<string, unknown> = {};
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key?.startsWith(STORE_PREFIX) || !partOf(tool, key.slice(STORE_PREFIX.length))) continue;
      parts[key.slice(STORE_PREFIX.length)] = JSON.parse(window.localStorage.getItem(key) ?? 'null') as unknown;
    }
  } catch {
    // Storage can be off; the block then keeps no inputs and reopens the tool as it is.
  }
  return parts;
}

/**
 * Puts a live calculation block's inputs back into `tool`'s fields and shows that tool. Only the tool's own parts
 * are written, and only objects, so a block cannot change another tool or any other setting.
 */
export function restoreSignalInputs(tool: string, inputs: unknown): boolean {
  if (!isSignalToolId(tool)) return false;
  if (inputs && typeof inputs === 'object') {
    try {
      for (const [part, value] of Object.entries(inputs as Record<string, unknown>)) {
        if (!partOf(tool, part) || !value || typeof value !== 'object' || Array.isArray(value)) continue;
        window.localStorage.setItem(STORE_PREFIX + part, JSON.stringify(value));
      }
    } catch {
      // The tool still opens, on what it last had.
    }
  }
  chooseSignalTool(tool);
  window.dispatchEvent(new CustomEvent(RESTORE_EVENT, { detail: tool }));
  return true;
}
